import path from 'node:path'
import { copyFile, rename, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type {
  BookmarkNode,
  DocumentInfo,
  FormFieldInfo,
  FormValueUpdate,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
  SaveDocumentResult,
  SetFormValuesResult,
} from '../../../shared/ipc'
import { writeFormValues } from './formWriter'
import { LruCache, makePageCacheKey } from './pageCache'
import {
  PdfiumEngine,
  type EngineRenderedPage,
  type PdfDocumentHandle,
  type PdfEngine,
} from './pdfEngine'

const DEFAULT_CACHE_ENTRIES = 48

type OpenDocument = {
  handle: PdfDocumentHandle
  info: DocumentInfo
  cache: LruCache<EngineRenderedPage>
  inflight: Map<string, Promise<EngineRenderedPage>>
  formValues: Map<string, string>
  dirty: boolean
  password?: string
}

export class DocumentSession {
  private readonly engine: PdfEngine
  private readonly documents = new Map<string, OpenDocument>()

  constructor(engine: PdfEngine = new PdfiumEngine()) {
    this.engine = engine
  }

  get documentIds(): string[] {
    return [...this.documents.keys()]
  }

  findByPath(filePath: string): DocumentInfo | null {
    const normalized = normalizePath(filePath)
    for (const entry of this.documents.values()) {
      if (normalizePath(entry.info.path) === normalized) {
        return toDocumentInfo(entry)
      }
    }
    return null
  }

  getDocument(documentId: string): DocumentInfo | null {
    const entry = this.documents.get(documentId)
    return entry ? toDocumentInfo(entry) : null
  }

  async open(filePath: string, password?: string): Promise<OpenDocumentResult> {
    const existing = this.findByPath(filePath)
    if (existing) {
      return { ok: true, document: existing }
    }

    try {
      const handle = await this.engine.open(filePath, password)
      const pages = await this.engine.getPages(handle)
      const formValues = await this.loadFormBaselines(handle, pages.length)
      const info: DocumentInfo = {
        documentId: handle.id,
        path: filePath,
        fileName: path.basename(filePath),
        pageCount: pages.length,
        pages,
        dirty: false,
      }
      this.documents.set(handle.id, {
        handle,
        info,
        cache: new LruCache<EngineRenderedPage>(DEFAULT_CACHE_ENTRIES),
        inflight: new Map(),
        formValues,
        dirty: false,
        password,
      })
      return { ok: true, document: toDocumentInfo(this.documents.get(handle.id)!) }
    } catch (error) {
      if (error instanceof Error && error.message === 'PASSWORD_REQUIRED') {
        return { ok: false, needsPassword: true, path: filePath }
      }
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async close(documentId?: string): Promise<void> {
    if (!documentId) {
      const ids = [...this.documents.keys()]
      for (const id of ids) {
        await this.closeOne(id)
      }
      return
    }
    await this.closeOne(documentId)
  }

  async renderPage(req: RenderPageRequest): Promise<RenderedPage> {
    const entry = this.documents.get(req.documentId)
    if (!entry) {
      throw new Error(`No document open: ${req.documentId}`)
    }
    const rotation = req.rotation ?? entry.info.pages[req.pageIndex]?.rotation ?? 0
    const key = makePageCacheKey(req.pageIndex, req.scale, rotation)
    const cached = entry.cache.get(key)
    if (cached) {
      return toWirePage(cached, req.requestId)
    }

    const existing = entry.inflight.get(key)
    if (existing) {
      const rendered = await existing
      return toWirePage(rendered, req.requestId)
    }

    const promise = this.engine
      .renderPage(entry.handle, {
        ...req,
        rotation,
      })
      .then((rendered) => {
        entry.cache.set(key, rendered)
        return rendered
      })
      .finally(() => {
        entry.inflight.delete(key)
      })

    entry.inflight.set(key, promise)
    const rendered = await promise
    return toWirePage(rendered, req.requestId)
  }

  async getBookmarks(documentId: string): Promise<BookmarkNode[]> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      throw new Error(`No document open: ${documentId}`)
    }
    return this.engine.getBookmarks(entry.handle)
  }

  async getFormFields(documentId: string): Promise<FormFieldInfo[]> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      throw new Error(`No document open: ${documentId}`)
    }
    const fields: FormFieldInfo[] = []
    for (let pageIndex = 0; pageIndex < entry.info.pageCount; pageIndex += 1) {
      const pageFields = await this.engine.getFormFields(entry.handle, pageIndex)
      for (const field of pageFields) {
        fields.push(applyPendingValue(field, entry.formValues))
      }
    }
    return fields
  }

  async setFormValues(
    documentId: string,
    updates: FormValueUpdate[],
  ): Promise<SetFormValuesResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }

    let changed = false
    for (const update of updates) {
      const next = update.value
      const previous = entry.formValues.get(update.name)
      if (previous === next) {
        continue
      }
      entry.formValues.set(update.name, next)
      changed = true
    }

    if (changed) {
      entry.dirty = true
      entry.info = { ...entry.info, dirty: true }
    }

    return { ok: true, document: toDocumentInfo(entry) }
  }

  async save(documentId: string): Promise<SaveDocumentResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open to save.' }
    }

    if (!entry.dirty) {
      return { ok: true, document: toDocumentInfo(entry) }
    }

    try {
      await this.persistDirtyValues(entry, entry.info.path)
      return { ok: true, document: toDocumentInfo(entry) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async saveAs(documentId: string, destPath: string): Promise<SaveDocumentResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open to save.' }
    }

    const sourcePath = entry.info.path
    if (normalizePath(sourcePath) === normalizePath(destPath)) {
      return this.save(documentId)
    }

    const conflict = this.findByPath(destPath)
    if (conflict && conflict.documentId !== documentId) {
      return { ok: false, error: 'That file is already open in another tab.' }
    }

    try {
      if (entry.dirty) {
        await this.persistDirtyValues(entry, destPath)
      } else {
        await copyFile(sourcePath, destPath)
        await this.reopenAfterWrite(entry, destPath)
      }
      return { ok: true, document: toDocumentInfo(entry) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  /**
   * Write filled values to dest. Releases the PDFium file lock before replacing
   * so Windows can overwrite the open path.
   */
  private async persistDirtyValues(entry: OpenDocument, destPath: string): Promise<void> {
    const sourcePath = entry.info.path
    const values = Object.fromEntries(entry.formValues)
    const tempPath = path.join(
      path.dirname(destPath),
      `.markstratum-save-${randomBytes(8).toString('hex')}.pdf`,
    )

    try {
      await writeFormValues(sourcePath, tempPath, values)
      await this.engine.release(entry.handle)
      await replaceFile(tempPath, destPath)
      await this.engine.reopen(entry.handle, destPath, entry.password)
      entry.info = {
        ...entry.info,
        path: destPath,
        fileName: path.basename(destPath),
        dirty: false,
      }
      entry.dirty = false
      entry.cache.clear()
      entry.inflight.clear()
      entry.formValues = await this.loadFormBaselines(entry.handle, entry.info.pageCount)
    } catch (error) {
      try {
        await unlink(tempPath)
      } catch {
        // temp may already have been moved
      }
      if (!this.documents.has(entry.handle.id)) {
        throw error
      }
      try {
        await this.engine.reopen(entry.handle, sourcePath, entry.password)
      } catch {
        // ignore secondary failure; surface the original error
      }
      throw error
    }
  }

  private async reopenAfterWrite(entry: OpenDocument, filePath: string): Promise<void> {
    await this.engine.reopen(entry.handle, filePath, entry.password)
    entry.info = {
      ...entry.info,
      path: filePath,
      fileName: path.basename(filePath),
      dirty: false,
    }
    entry.dirty = false
    entry.cache.clear()
    entry.inflight.clear()
    entry.formValues = await this.loadFormBaselines(entry.handle, entry.info.pageCount)
  }

  private async loadFormBaselines(
    handle: PdfDocumentHandle,
    pageCount: number,
  ): Promise<Map<string, string>> {
    const values = new Map<string, string>()
    const radioResolved = new Set<string>()
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const fields = await this.engine.getFormFields(handle, pageIndex)
      for (const field of fields) {
        if (field.type === 'radioButton') {
          if (radioResolved.has(field.name)) {
            continue
          }
          if (field.isChecked) {
            values.set(field.name, field.exportValue || field.value || '')
            radioResolved.add(field.name)
          } else if (!values.has(field.name)) {
            values.set(field.name, field.value || '')
          }
          continue
        }
        if (values.has(field.name)) {
          continue
        }
        values.set(field.name, canonicalFieldValue(field))
      }
    }
    return values
  }

  private async closeOne(documentId: string): Promise<void> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return
    }
    this.documents.delete(documentId)
    entry.cache.clear()
    entry.inflight.clear()
    await this.engine.close(entry.handle)
  }
}

export function canonicalFieldValue(field: FormFieldInfo): string {
  if (field.type === 'checkbox') {
    return field.isChecked ? 'true' : 'false'
  }
  if (field.type === 'radioButton') {
    if (field.isChecked) {
      return field.exportValue || field.value || ''
    }
    // Unchecked widgets in a group still share the name; keep any non-empty
    // value already stored for the group when merging baselines.
    return field.value || ''
  }
  return field.value ?? ''
}

function applyPendingValue(field: FormFieldInfo, pending: Map<string, string>): FormFieldInfo {
  if (!pending.has(field.name)) {
    return field
  }
  const value = pending.get(field.name)!
  if (field.type === 'checkbox') {
    const isChecked = value === 'true' || value === 'Yes' || value === 'On' || value === '1'
    return { ...field, value, isChecked }
  }
  if (field.type === 'radioButton') {
    const exportOrValue = field.exportValue || field.value
    const isChecked = Boolean(value) && value === exportOrValue
    return { ...field, value, isChecked }
  }
  return { ...field, value }
}

function toDocumentInfo(entry: OpenDocument): DocumentInfo {
  return {
    ...entry.info,
    dirty: entry.dirty,
  }
}

function toWirePage(rendered: EngineRenderedPage, requestId: string): RenderedPage {
  return {
    pageIndex: rendered.pageIndex,
    scale: rendered.scale,
    width: rendered.width,
    height: rendered.height,
    mimeType: rendered.mimeType,
    dataBase64: rendered.data.toString('base64'),
    requestId,
  }
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath).toLowerCase()
}

async function replaceFile(sourcePath: string, destPath: string): Promise<void> {
  try {
    await rename(sourcePath, destPath)
  } catch {
    try {
      await unlink(destPath)
    } catch {
      // dest may not exist yet
    }
    await rename(sourcePath, destPath)
  }
}
