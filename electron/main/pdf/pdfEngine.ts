import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadDocument,
  PDFiumPasswordError,
  type Bookmark,
  type FormField,
  type PDFiumDocument,
  type PDFiumPage,
} from 'pdfium-native'
import {
  FormFieldFlags,
  type BookmarkNode,
  type FormFieldInfo,
  type FormFieldType,
  type PageInfo,
  type SizePts,
} from '../../../shared/ipc'

export type PdfDocumentHandle = {
  id: string
  path: string
}

export type EngineRenderRequest = {
  pageIndex: number
  scale: number
  rotation?: 0 | 1 | 2 | 3
  requestId: string
}

export type EngineRenderedPage = {
  pageIndex: number
  scale: number
  width: number
  height: number
  mimeType: 'image/jpeg'
  data: Buffer
  requestId: string
}

const MAX_RENDER_EDGE_PX = 4096
const DEFAULT_PAGE_WIDTH = 612
const DEFAULT_PAGE_HEIGHT = 792

export interface PdfEngine {
  open(path: string, password?: string): Promise<PdfDocumentHandle>
  reopen(doc: PdfDocumentHandle, path: string, password?: string): Promise<void>
  /** Destroy the native document to release file locks, keeping the handle id. */
  release(doc: PdfDocumentHandle): Promise<void>
  getPageCount(doc: PdfDocumentHandle): number
  getPageSize(doc: PdfDocumentHandle, pageIndex: number): Promise<SizePts>
  getPages(doc: PdfDocumentHandle): Promise<PageInfo[]>
  getBookmarks(doc: PdfDocumentHandle): Promise<BookmarkNode[]>
  getFormFields(doc: PdfDocumentHandle, pageIndex: number): Promise<FormFieldInfo[]>
  renderPage(doc: PdfDocumentHandle, req: EngineRenderRequest): Promise<EngineRenderedPage>
  close(doc: PdfDocumentHandle): Promise<void>
}

type InternalDoc = {
  handle: PdfDocumentHandle
  native: PDFiumDocument | null
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

  async reopen(doc: PdfDocumentHandle, filePath: string, password?: string): Promise<void> {
    const internal = this.docs.get(doc.id)
    if (internal?.native) {
      internal.native.destroy()
      internal.native = null
    }
    try {
      const native = await loadDocument(filePath, password)
      doc.path = filePath
      this.docs.set(doc.id, { handle: doc, native })
    } catch (error) {
      if (isPasswordError(error)) {
        const passwordError = new Error('PASSWORD_REQUIRED')
        passwordError.name = 'PasswordRequiredError'
        throw passwordError
      }
      throw error
    }
  }

  async release(doc: PdfDocumentHandle): Promise<void> {
    const internal = this.docs.get(doc.id)
    if (!internal?.native) {
      return
    }
    internal.native.destroy()
    internal.native = null
  }

  getPageCount(doc: PdfDocumentHandle): number {
    return this.requireNative(doc).pageCount
  }

  async getPageSize(doc: PdfDocumentHandle, pageIndex: number): Promise<SizePts> {
    const page = await this.requireNative(doc).getPage(pageIndex)
    try {
      return { width: page.width, height: page.height }
    } finally {
      page.close()
    }
  }

  async getPages(doc: PdfDocumentHandle): Promise<PageInfo[]> {
    const native = this.requireNative(doc)
    const pageCount = native.pageCount
    if (pageCount <= 0) {
      return []
    }

    // Fast open: probe the first page, then reuse its size for placeholders.
    const first = await native.getPage(0)
    let width = DEFAULT_PAGE_WIDTH
    let height = DEFAULT_PAGE_HEIGHT
    let rotation: 0 | 1 | 2 | 3 = 0
    try {
      width = first.width || DEFAULT_PAGE_WIDTH
      height = first.height || DEFAULT_PAGE_HEIGHT
      rotation = normalizeRotation(first.rotation)
    } finally {
      first.close()
    }

    return Array.from({ length: pageCount }, (_, index) => ({
      index,
      width,
      height,
      rotation: index === 0 ? rotation : 0,
    }))
  }

  async getBookmarks(doc: PdfDocumentHandle): Promise<BookmarkNode[]> {
    const bookmarks = await this.requireNative(doc).getBookmarks()
    return bookmarks.map(toBookmarkNode)
  }

  async getFormFields(doc: PdfDocumentHandle, pageIndex: number): Promise<FormFieldInfo[]> {
    const page = await this.requireNative(doc).getPage(pageIndex)
    try {
      const fields = await page.getFormFields()
      return fields
        .map((field) => toFormFieldInfo(field, pageIndex))
        .filter((field): field is FormFieldInfo => field !== null)
    } finally {
      page.close()
    }
  }

  async renderPage(
    doc: PdfDocumentHandle,
    req: EngineRenderRequest,
  ): Promise<EngineRenderedPage> {
    const page = await this.requireNative(doc).getPage(req.pageIndex)
    try {
      const scale = clampScale(req.scale, page)
      const tempDir = mkdtempSync(join(tmpdir(), 'markstratum-render-'))
      const outputPath = join(tempDir, 'page.jpg')
      try {
        // Write to disk instead of returning a Buffer. Returning native render
        // buffers through Electron's main process can stall on Windows.
        await page.render({
          scale,
          format: 'jpeg',
          quality: 80,
          rotation: req.rotation ?? 0,
          renderAnnotations: true,
          output: outputPath,
        })
        const data = readFileSync(outputPath)
        const { width, height } = estimatePixelSize(page, scale, req.rotation ?? 0)
        return {
          pageIndex: req.pageIndex,
          scale,
          width,
          height,
          mimeType: 'image/jpeg',
          data,
          requestId: req.requestId,
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
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
    internal.native?.destroy()
    this.docs.delete(doc.id)
  }

  private requireNative(doc: PdfDocumentHandle): PDFiumDocument {
    const internal = this.docs.get(doc.id)
    if (!internal?.native) {
      throw new Error(`Document not open: ${doc.id}`)
    }
    return internal.native
  }
}

function normalizeRotation(value: number): 0 | 1 | 2 | 3 {
  const mod = ((Number(value) % 4) + 4) % 4
  if (mod === 1 || mod === 2 || mod === 3) {
    return mod
  }
  return 0
}

function toBookmarkNode(bookmark: Bookmark): BookmarkNode {
  return {
    title: bookmark.title,
    pageIndex: bookmark.pageIndex,
    open: bookmark.open,
    actionType: bookmark.actionType,
    url: bookmark.url,
    children: bookmark.children?.map(toBookmarkNode),
  }
}

const CORE_FORM_TYPES = new Set<FormFieldType>([
  'textField',
  'checkbox',
  'radioButton',
  'comboBox',
  'listBox',
])

function toFormFieldInfo(field: FormField, pageIndex: number): FormFieldInfo | null {
  if (!CORE_FORM_TYPES.has(field.type as FormFieldType)) {
    return null
  }
  const type = field.type as FormFieldType
  const flags = Number(field.flags) || 0
  return {
    pageIndex,
    name: field.name,
    type,
    value: field.value ?? '',
    isChecked: Boolean(field.isChecked),
    exportValue: field.exportValue,
    alternateName: field.alternateName,
    flags,
    bounds: field.bounds
      ? {
          left: field.bounds.left,
          bottom: field.bounds.bottom,
          right: field.bounds.right,
          top: field.bounds.top,
        }
      : undefined,
    options: field.options?.map((option) => ({
      label: option.label,
      isSelected: option.isSelected,
    })),
    readOnly: (flags & FormFieldFlags.readOnly) !== 0,
    multiline: type === 'textField' && (flags & FormFieldFlags.multiline) !== 0,
  }
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
