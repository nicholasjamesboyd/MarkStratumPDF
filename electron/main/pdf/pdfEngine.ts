import {
  loadDocument,
  PDFiumPasswordError,
  type PDFiumDocument,
  type PDFiumPage,
} from 'pdfium-native'
import type { PageInfo, RenderedPage, SizePts } from '../../../shared/ipc'

export type PdfDocumentHandle = {
  id: string
  path: string
}

export type RenderPageRequest = {
  pageIndex: number
  scale: number
  rotation?: 0 | 1 | 2 | 3
  requestId: string
}

const MAX_RENDER_EDGE_PX = 4096

export interface PdfEngine {
  open(path: string, password?: string): Promise<PdfDocumentHandle>
  getPageCount(doc: PdfDocumentHandle): number
  getPageSize(doc: PdfDocumentHandle, pageIndex: number): Promise<SizePts>
  getPages(doc: PdfDocumentHandle): Promise<PageInfo[]>
  renderPage(doc: PdfDocumentHandle, req: RenderPageRequest): Promise<RenderedPage>
  close(doc: PdfDocumentHandle): Promise<void>
}

type InternalDoc = {
  handle: PdfDocumentHandle
  native: PDFiumDocument
}

function isPasswordError(error: unknown): boolean {
  if (error instanceof PDFiumPasswordError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /password|encrypt|security/i.test(message)
}

export class PdfiumEngine implements PdfEngine {
  private readonly docs = new Map<string, InternalDoc>()
  private nextId = 1

  async open(filePath: string, password?: string): Promise<PdfDocumentHandle> {
    try {
      const native = await loadDocument(filePath, password)
      const handle: PdfDocumentHandle = {
        id: `doc-${this.nextId++}`,
        path: filePath,
      }
      this.docs.set(handle.id, { handle, native })
      return handle
    } catch (error) {
      if (isPasswordError(error)) {
        const passwordError = new Error('PASSWORD_REQUIRED')
        passwordError.name = 'PasswordRequiredError'
        throw passwordError
      }
      throw error
    }
  }

  getPageCount(doc: PdfDocumentHandle): number {
    return this.requireDoc(doc).native.pageCount
  }

  async getPageSize(doc: PdfDocumentHandle, pageIndex: number): Promise<SizePts> {
    const page = await this.requireDoc(doc).native.getPage(pageIndex)
    try {
      return { width: page.width, height: page.height }
    } finally {
      page.close()
    }
  }

  async getPages(doc: PdfDocumentHandle): Promise<PageInfo[]> {
    const native = this.requireDoc(doc).native
    const pages: PageInfo[] = []
    for (let index = 0; index < native.pageCount; index += 1) {
      const page = await native.getPage(index)
      try {
        pages.push({
          index,
          width: page.width,
          height: page.height,
          rotation: normalizeRotation(page.rotation),
        })
      } finally {
        page.close()
      }
    }
    return pages
  }

  async renderPage(
    doc: PdfDocumentHandle,
    req: RenderPageRequest,
  ): Promise<RenderedPage> {
    const page = await this.requireDoc(doc).native.getPage(req.pageIndex)
    try {
      const scale = clampScale(req.scale, page)
      const buffer = await page.render({
        scale,
        format: 'jpeg',
        quality: 85,
        rotation: req.rotation ?? 0,
        renderAnnotations: true,
      })
      const { width, height } = estimatePixelSize(page, scale, req.rotation ?? 0)
      return {
        pageIndex: req.pageIndex,
        scale,
        width,
        height,
        mimeType: 'image/jpeg',
        data: new Uint8Array(buffer),
        requestId: req.requestId,
      }
    } finally {
      page.close()
    }
  }

  async close(doc: PdfDocumentHandle): Promise<void> {
    const internal = this.docs.get(doc.id)
    if (!internal) {
      return
    }
    internal.native.destroy()
    this.docs.delete(doc.id)
  }

  private requireDoc(doc: PdfDocumentHandle): InternalDoc {
    const internal = this.docs.get(doc.id)
    if (!internal) {
      throw new Error(`Document not open: ${doc.id}`)
    }
    return internal
  }
}

function normalizeRotation(value: number): 0 | 1 | 2 | 3 {
  const mod = ((value % 4) + 4) % 4
  return mod as 0 | 1 | 2 | 3
}

function clampScale(scale: number, page: PDFiumPage): number {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const maxDim = Math.max(page.width, page.height) * safeScale
  if (maxDim <= MAX_RENDER_EDGE_PX) {
    return safeScale
  }
  return MAX_RENDER_EDGE_PX / Math.max(page.width, page.height)
}

function estimatePixelSize(
  page: PDFiumPage,
  scale: number,
  rotation: 0 | 1 | 2 | 3,
): SizePts {
  const width = Math.max(1, Math.round(page.width * scale))
  const height = Math.max(1, Math.round(page.height * scale))
  if (rotation === 1 || rotation === 3) {
    return { width: height, height: width }
  }
  return { width, height }
}
