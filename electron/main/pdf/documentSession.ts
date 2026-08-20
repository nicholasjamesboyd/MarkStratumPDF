import path from 'node:path'
import { copyFile, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type {
  BookmarkNode,
  DocumentInfo,
  FormFieldInfo,
  FormValueUpdate,
  LayerInfo,
  LayerMutationResult,
  OpenDocumentResult,
  PageMutationResult,
  PickPdfPathResult,
  SplitDocumentResult,
  ExtractPagesResult,
  PageCropRect,
  RenderedPage,
  RenderPageRequest,
  SaveDocumentResult,
  SetFormValuesResult,
} from '../../../shared/ipc'
import { writeFormValues } from './formWriter'
import {
  createLayerInBytes,
  deleteLayerInBytes,
  listLayersFromBytes,
  renameLayerInBytes,
  setLayerVisibilityInBytes,
} from './ocgService'
import {
  cropPagesInBytes,
  deletePagesInBytes,
  extractPagesToBytes,
  insertBlankPageInBytes,
  insertPagesFromBytes,
  reorderPagesInBytes,
  replacePagesInBytes,
  rotatePagesInBytes,
  splitDocumentAtPageBytes,
} from './pageOps'
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
  /** Temp PDF with pending layer or page edits; PDFium renders from this when set. */
  workPath?: string
  layersRevision: number
  pagesRevision: number
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
    const entry = this.findEntryByPath(filePath)
    return entry ? toDocumentInfo(entry) : null
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
        layersRevision: 0,
        pagesRevision: 0,
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
    const extraRotation = req.rotation ?? 0
    const pageRotation = entry.info.pages[req.pageIndex]?.rotation ?? 0
    const effectiveRotation = normalizeRenderRotation(pageRotation, extraRotation)
    const key = makePageCacheKey(req.pageIndex, req.scale, effectiveRotation)
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
        rotation: extraRotation,
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

  async getLayers(documentId: string): Promise<LayerInfo[]> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      throw new Error(`No document open: ${documentId}`)
    }
    const bytes = await readFile(renderPath(entry))
    return listLayersFromBytes(bytes)
  }

  async setLayerVisibility(
    documentId: string,
    layerId: string,
    visible: boolean,
  ): Promise<LayerMutationResult> {
    if (layerId.startsWith('group:')) {
      return { ok: false, error: 'Layer groups cannot be toggled directly.' }
    }
    return this.mutateLayers(documentId, (bytes) =>
      setLayerVisibilityInBytes(bytes, layerId, visible),
    )
  }

  async createLayer(
    documentId: string,
    name: string,
    visible = true,
  ): Promise<LayerMutationResult> {
    return this.mutateLayers(documentId, async (bytes) => {
      const result = await createLayerInBytes(bytes, name, visible)
      return result.bytes
    })
  }

  async renameLayer(
    documentId: string,
    layerId: string,
    name: string,
  ): Promise<LayerMutationResult> {
    return this.mutateLayers(documentId, (bytes) => renameLayerInBytes(bytes, layerId, name))
  }

  async deleteLayer(documentId: string, layerId: string): Promise<LayerMutationResult> {
    if (layerId.startsWith('group:')) {
      return { ok: false, error: 'Layer groups cannot be deleted.' }
    }
    return this.mutateLayers(documentId, (bytes) => deleteLayerInBytes(bytes, layerId))
  }

  async reorderPages(
    documentId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<PageMutationResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }

    const pageCount = entry.info.pageCount
    if (pageCount === 0) {
      return { ok: true, document: toDocumentInfo(entry), pagesRevision: entry.pagesRevision }
    }

    const from = clampIndex(fromIndex, 0, pageCount - 1)
    const to = clampIndex(toIndex, 0, pageCount - 1)
    if (from === to) {
      return { ok: true, document: toDocumentInfo(entry), pagesRevision: entry.pagesRevision }
    }

    return this.mutatePages(entry, (bytes) => reorderPagesInBytes(bytes, from, to))
  }

  async insertPagesFromDocument(
    targetDocumentId: string,
    sourceDocumentId: string,
    insertAt: number,
  ): Promise<PageMutationResult> {
    const target = this.documents.get(targetDocumentId)
    if (!target) {
      return { ok: false, error: 'No document open.' }
    }
    if (targetDocumentId === sourceDocumentId) {
      return { ok: true, document: toDocumentInfo(target), pagesRevision: target.pagesRevision }
    }

    const source = this.documents.get(sourceDocumentId)
    if (!source) {
      return { ok: false, error: 'Source document is not open.' }
    }

    try {
      const sourceBytes = await readFile(renderPath(source))
      return await this.mutatePages(target, (bytes) =>
        insertPagesFromBytes(bytes, sourceBytes, insertAt),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async insertPagesFromPath(
    targetDocumentId: string,
    filePath: string,
    insertAt: number,
  ): Promise<PageMutationResult> {
    const existing = this.findByPath(filePath)
    if (existing) {
      return this.insertPagesFromDocument(targetDocumentId, existing.documentId, insertAt)
    }

    const target = this.documents.get(targetDocumentId)
    if (!target) {
      return { ok: false, error: 'No document open.' }
    }

    try {
      const sourceBytes = await readFile(filePath)
      return await this.mutatePages(target, (bytes) =>
        insertPagesFromBytes(bytes, sourceBytes, insertAt),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async deletePages(documentId: string, indices: number[]): Promise<PageMutationResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }
    if (indices.length === 0) {
      return { ok: true, document: toDocumentInfo(entry), pagesRevision: entry.pagesRevision }
    }
    return this.mutatePages(entry, (bytes) => deletePagesInBytes(bytes, indices))
  }

  async rotatePages(
    documentId: string,
    indices: number[],
    quarterTurns: 1 | 3,
  ): Promise<PageMutationResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }
    if (indices.length === 0) {
      return { ok: true, document: toDocumentInfo(entry), pagesRevision: entry.pagesRevision }
    }
    return this.mutatePages(entry, (bytes) => rotatePagesInBytes(bytes, indices, quarterTurns))
  }

  async insertBlankPage(
    documentId: string,
    insertAt: number,
  ): Promise<PageMutationResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }
    return this.mutatePages(entry, (bytes) => insertBlankPageInBytes(bytes, insertAt))
  }

  async cropPages(
    documentId: string,
    pageIndices: number[],
    relativeCrop: PageCropRect,
  ): Promise<PageMutationResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }
    if (pageIndices.length === 0) {
      return { ok: true, document: toDocumentInfo(entry), pagesRevision: entry.pagesRevision }
    }
    return this.mutatePages(entry, (bytes) =>
      cropPagesInBytes(bytes, pageIndices, relativeCrop),
    )
  }

  async replacePagesFromDocument(
    targetDocumentId: string,
    targetIndices: number[],
    sourceDocumentId: string,
    sourceStartIndex: number,
  ): Promise<PageMutationResult> {
    const target = this.documents.get(targetDocumentId)
    if (!target) {
      return { ok: false, error: 'No document open.' }
    }
    const source = this.documents.get(sourceDocumentId)
    if (!source) {
      return { ok: false, error: 'Source document is not open.' }
    }
    try {
      const sourceBytes = await readFile(renderPath(source))
      return await this.mutatePages(target, (bytes) =>
        replacePagesInBytes(bytes, targetIndices, sourceBytes, sourceStartIndex),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async replacePagesFromPath(
    targetDocumentId: string,
    targetIndices: number[],
    filePath: string,
    sourceStartIndex: number,
  ): Promise<PageMutationResult> {
    const existing = this.findByPath(filePath)
    if (existing) {
      return this.replacePagesFromDocument(
        targetDocumentId,
        targetIndices,
        existing.documentId,
        sourceStartIndex,
      )
    }

    const target = this.documents.get(targetDocumentId)
    if (!target) {
      return { ok: false, error: 'No document open.' }
    }

    try {
      const sourceBytes = await readFile(filePath)
      return await this.mutatePages(target, (bytes) =>
        replacePagesInBytes(bytes, targetIndices, sourceBytes, sourceStartIndex),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async extractPagesToFile(
    documentId: string,
    indices: number[],
    destPath: string,
  ): Promise<ExtractPagesResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }
    try {
      const sourceBytes = await readFile(renderPath(entry))
      const extracted = await extractPagesToBytes(sourceBytes, indices)
      await writeFile(destPath, extracted)
      return { ok: true, savedPath: destPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async splitDocumentAtPage(
    documentId: string,
    splitAt: number,
    afterDestPath: string,
  ): Promise<SplitDocumentResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }

    try {
      const sourceBytes = await readFile(renderPath(entry))
      const { before, after } = await splitDocumentAtPageBytes(sourceBytes, splitAt)
      await writeFile(afterDestPath, after)
      await this.mutatePages(entry, async () => before)
      return {
        ok: true,
        document: toDocumentInfo(entry),
        pagesRevision: entry.pagesRevision,
        savedPath: afterDestPath,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  private async mutateLayers(
    documentId: string,
    mutate: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<LayerMutationResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open.' }
    }

    try {
      const sourceBytes = await readFile(renderPath(entry))
      const nextBytes = await mutate(sourceBytes)
      await this.commitWorkingPdf(entry, nextBytes, { refreshPages: false })
      entry.layersRevision += 1
      const layers = await listLayersFromBytes(nextBytes)
      return {
        ok: true,
        document: toDocumentInfo(entry),
        layers,
        layersRevision: entry.layersRevision,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  private async mutatePages(
    entry: OpenDocument,
    mutate: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<PageMutationResult> {
    try {
      const sourceBytes = await readFile(renderPath(entry))
      const nextBytes = await mutate(sourceBytes)
      await this.commitWorkingPdf(entry, nextBytes, { refreshPages: true })
      return {
        ok: true,
        document: toDocumentInfo(entry),
        pagesRevision: entry.pagesRevision,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  private async commitWorkingPdf(
    entry: OpenDocument,
    nextBytes: Uint8Array,
    options: { refreshPages: boolean },
  ): Promise<void> {
    const nextWorkPath = path.join(
      path.dirname(entry.info.path),
      `.markstratum-work-${randomBytes(8).toString('hex')}.pdf`,
    )
    await writeFile(nextWorkPath, nextBytes)

    const previousWorkPath = entry.workPath
    await this.engine.release(entry.handle)
    try {
      await this.engine.reopen(entry.handle, nextWorkPath, entry.password)
    } catch (error) {
      try {
        await this.engine.reopen(entry.handle, renderPath(entry), entry.password)
      } catch {
        // ignore secondary failure
      }
      try {
        await unlink(nextWorkPath)
      } catch {
        // ignore
      }
      throw error
    }

    entry.workPath = nextWorkPath
    entry.dirty = true
    entry.cache.clear()
    entry.inflight.clear()

    if (options.refreshPages) {
      const pages = await this.engine.getPages(entry.handle)
      entry.pagesRevision += 1
      entry.info = {
        ...entry.info,
        pages,
        pageCount: pages.length,
        dirty: true,
      }
    } else {
      entry.info = { ...entry.info, dirty: true }
    }

    if (previousWorkPath && previousWorkPath !== nextWorkPath) {
      try {
        await unlink(previousWorkPath)
      } catch {
        // ignore stale temp cleanup
      }
    }
  }

  private findEntryByPath(filePath: string): OpenDocument | null {
    const normalized = normalizePath(filePath)
    for (const entry of this.documents.values()) {
      if (normalizePath(entry.info.path) === normalized) {
        return entry
      }
    }
    return null
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
   * Write filled values (and any pending layer work file) to dest. Releases the
   * PDFium file lock before replacing so Windows can overwrite the open path.
   */
  private async persistDirtyValues(entry: OpenDocument, destPath: string): Promise<void> {
    const sourcePath = entry.info.path
    const values = Object.fromEntries(entry.formValues)
    const readPath = renderPath(entry)
    const tempPath = path.join(
      path.dirname(destPath),
      `.markstratum-save-${randomBytes(8).toString('hex')}.pdf`,
    )
    const previousWorkPath = entry.workPath

    try {
      await writeFormValues(readPath, tempPath, values)
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
      entry.workPath = undefined
      entry.cache.clear()
      entry.inflight.clear()
      entry.formValues = await this.loadFormBaselines(entry.handle, entry.info.pageCount)

      if (previousWorkPath) {
        try {
          await unlink(previousWorkPath)
        } catch {
          // ignore
        }
      }
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
        await this.engine.reopen(entry.handle, renderPath(entry), entry.password)
      } catch {
        // ignore secondary failure; surface the original error
      }
      // restore sourcePath reopen fallback if work path is gone
      if (!entry.workPath) {
        try {
          await this.engine.reopen(entry.handle, sourcePath, entry.password)
        } catch {
          // ignore
        }
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
    entry.workPath = undefined
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
    const workPath = entry.workPath
    await this.engine.close(entry.handle)
    if (workPath) {
      try {
        await unlink(workPath)
      } catch {
        // ignore
      }
    }
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

function renderPath(entry: OpenDocument): string {
  return entry.workPath ?? entry.info.path
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

function normalizeRenderRotation(pageRotation: number, extraRotation: number): 0 | 1 | 2 | 3 {
  const mod = ((pageRotation + extraRotation) % 4 + 4) % 4
  if (mod === 1 || mod === 2 || mod === 3) {
    return mod
  }
  return 0
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath).toLowerCase()
}

function clampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
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
