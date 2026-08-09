import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import type {
  BookmarkNode,
  DocumentInfo,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
  SaveDocumentResult,
} from '../../../shared/ipc'
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
        return entry.info
      }
    }
    return null
  }

  getDocument(documentId: string): DocumentInfo | null {
    return this.documents.get(documentId)?.info ?? null
  }

  async open(filePath: string, password?: string): Promise<OpenDocumentResult> {
    const existing = this.findByPath(filePath)
    if (existing) {
      return { ok: true, document: existing }
    }

    try {
      const handle = await this.engine.open(filePath, password)
      const pages = await this.engine.getPages(handle)
      const info: DocumentInfo = {
        documentId: handle.id,
        path: filePath,
        fileName: path.basename(filePath),
        pageCount: pages.length,
        pages,
      }
      this.documents.set(handle.id, {
        handle,
        info,
        cache: new LruCache<EngineRenderedPage>(DEFAULT_CACHE_ENTRIES),
        inflight: new Map(),
      })
      return { ok: true, document: info }
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

  async save(documentId: string): Promise<SaveDocumentResult> {
    const entry = this.documents.get(documentId)
    if (!entry) {
      return { ok: false, error: 'No document open to save.' }
    }
    // View-only for now: the file on disk is already current.
    return { ok: true, document: entry.info }
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
      await copyFile(sourcePath, destPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }

    const info: DocumentInfo = {
      ...entry.info,
      path: destPath,
      fileName: path.basename(destPath),
    }
    entry.info = info
    entry.handle.path = destPath
    return { ok: true, document: info }
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
