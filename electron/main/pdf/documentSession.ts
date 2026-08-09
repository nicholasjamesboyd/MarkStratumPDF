import path from 'node:path'
import os from 'node:os'
import type {
  DocumentInfo,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
} from '../../../shared/ipc'
import { LruCache, makePageCacheKey } from './pageCache'
import {
  PdfiumEngine,
  type EngineRenderedPage,
  type PdfDocumentHandle,
  type PdfEngine,
} from './pdfEngine'

const DEFAULT_CACHE_ENTRIES = 48

export class DocumentSession {
  private readonly engine: PdfEngine
  private readonly cache = new LruCache<EngineRenderedPage>(DEFAULT_CACHE_ENTRIES)
  private readonly inflight = new Map<string, Promise<EngineRenderedPage>>()
  private readonly queue: Array<() => void> = []
  private activeWorkers = 0
  private readonly maxWorkers: number
  private current: { handle: PdfDocumentHandle; info: DocumentInfo } | null = null

  constructor(engine: PdfEngine = new PdfiumEngine(), maxWorkers = Math.max(1, os.cpus().length - 1)) {
    this.engine = engine
    this.maxWorkers = maxWorkers
  }

  get document(): DocumentInfo | null {
    return this.current?.info ?? null
  }

  async open(filePath: string, password?: string): Promise<OpenDocumentResult> {
    await this.close()
    try {
      const handle = await this.engine.open(filePath, password)
      const pages = await this.engine.getPages(handle)
      const info: DocumentInfo = {
        path: filePath,
        fileName: path.basename(filePath),
        pageCount: pages.length,
        pages,
      }
      this.current = { handle, info }
      return { ok: true, document: info }
    } catch (error) {
      if (error instanceof Error && error.message === 'PASSWORD_REQUIRED') {
        return { ok: false, needsPassword: true, path: filePath }
      }
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async close(): Promise<void> {
    if (!this.current) {
      this.cache.clear()
      this.inflight.clear()
      return
    }
    const { handle } = this.current
    this.current = null
    this.cache.clear()
    this.inflight.clear()
    await this.engine.close(handle)
  }

  async renderPage(req: RenderPageRequest): Promise<RenderedPage> {
    if (!this.current) {
      throw new Error('No document open')
    }
    const rotation = req.rotation ?? this.current.info.pages[req.pageIndex]?.rotation ?? 0
    const key = makePageCacheKey(req.pageIndex, req.scale, rotation)
    const cached = this.cache.get(key)
    if (cached) {
      return toWirePage(cached, req.requestId)
    }

    const existing = this.inflight.get(key)
    if (existing) {
      const rendered = await existing
      return toWirePage(rendered, req.requestId)
    }

    const handle = this.current.handle
    const promise = this.enqueue(async () => {
      const rendered = await this.engine.renderPage(handle, {
        ...req,
        rotation,
      })
      this.cache.set(key, rendered)
      return rendered
    }).finally(() => {
      this.inflight.delete(key)
    })

    this.inflight.set(key, promise)
    const rendered = await promise
    return toWirePage(rendered, req.requestId)
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.activeWorkers += 1
        task()
          .then(resolve, reject)
          .finally(() => {
            this.activeWorkers -= 1
            const next = this.queue.shift()
            if (next) {
              next()
            }
          })
      }

      if (this.activeWorkers < this.maxWorkers) {
        run()
      } else {
        this.queue.push(run)
      }
    })
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
