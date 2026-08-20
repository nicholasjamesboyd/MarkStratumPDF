import { PDFDocument, degrees, type PDFPage } from 'pdf-lib'
import type { PageCropRect } from '../../../shared/ipc'

export type { PageCropRect }

const DEFAULT_PAGE_SIZE: [number, number] = [612, 792]

export async function reorderPagesInBytes(
  bytes: Uint8Array,
  fromIndex: number,
  toIndex: number,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const pageCount = pdf.getPageCount()
  if (pageCount === 0) {
    return bytes
  }

  const from = clampIndex(fromIndex, 0, pageCount - 1)
  const to = clampIndex(toIndex, 0, pageCount - 1)
  if (from === to) {
    return bytes
  }

  const [copied] = await pdf.copyPages(pdf, [from])
  pdf.removePage(from)
  pdf.insertPage(to, copied)
  return pdf.save({ useObjectStreams: false })
}

export async function insertPagesFromBytes(
  targetBytes: Uint8Array,
  sourceBytes: Uint8Array,
  insertAt: number,
): Promise<Uint8Array> {
  const source = await loadPdf(sourceBytes)
  const dest = await loadPdf(targetBytes)
  const sourceCount = source.getPageCount()
  if (sourceCount === 0) {
    return targetBytes
  }

  const insertIndex = clampIndex(insertAt, 0, dest.getPageCount())
  const copied = await dest.copyPages(source, source.getPageIndices())
  copied.forEach((page, offset) => {
    dest.insertPage(insertIndex + offset, page)
  })
  return dest.save({ useObjectStreams: false })
}

export async function deletePagesInBytes(
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const pageCount = pdf.getPageCount()
  if (pageCount === 0) {
    return bytes
  }

  const unique = [...new Set(indices.map((i) => clampIndex(i, 0, pageCount - 1)))].sort(
    (a, b) => b - a,
  )
  if (unique.length === 0) {
    return bytes
  }
  if (unique.length >= pageCount) {
    throw new Error('Keep at least one page.')
  }

  for (const index of unique) {
    pdf.removePage(index)
  }
  return pdf.save({ useObjectStreams: false })
}

export async function rotatePagesInBytes(
  bytes: Uint8Array,
  indices: number[],
  quarterTurns: 1 | 3,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const pageCount = pdf.getPageCount()
  if (pageCount === 0 || indices.length === 0) {
    return bytes
  }

  const pages = pdf.getPages()
  const unique = [...new Set(indices.map((i) => clampIndex(i, 0, pageCount - 1)))]
  for (const index of unique) {
    const page = pages[index]
    if (!page) {
      continue
    }
    const current = page.getRotation().angle / 90
    const next = (current + quarterTurns) % 4
    page.setRotation(degrees(next * 90))
  }
  return pdf.save({ useObjectStreams: false })
}

export async function insertBlankPageInBytes(
  bytes: Uint8Array,
  insertAt: number,
  size?: [number, number],
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const pageCount = pdf.getPageCount()
  const insertIndex = clampIndex(insertAt, 0, pageCount)

  let pageSize = size ?? DEFAULT_PAGE_SIZE
  if (!size && pageCount > 0) {
    const refIndex = insertIndex > 0 ? insertIndex - 1 : 0
    const refSize = pdf.getPages()[refIndex]?.getSize()
    if (refSize) {
      pageSize = [refSize.width, refSize.height]
    }
  }

  pdf.insertPage(insertIndex, pageSize)
  return pdf.save({ useObjectStreams: false })
}

export async function extractPagesToBytes(
  bytes: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const source = await loadPdf(bytes)
  const pageCount = source.getPageCount()
  if (pageCount === 0 || indices.length === 0) {
    throw new Error('Select at least one page to extract.')
  }

  const unique = [...new Set(indices.map((i) => clampIndex(i, 0, pageCount - 1)))].sort(
    (a, b) => a - b,
  )
  const dest = await PDFDocument.create()
  const copied = await dest.copyPages(source, unique)
  copied.forEach((page) => {
    dest.addPage(page)
  })
  return dest.save({ useObjectStreams: false })
}

export async function splitDocumentAtPageBytes(
  bytes: Uint8Array,
  splitAt: number,
): Promise<{ before: Uint8Array; after: Uint8Array }> {
  const source = await loadPdf(bytes)
  const pageCount = source.getPageCount()
  if (pageCount === 0) {
    throw new Error('This PDF has no pages.')
  }

  const splitIndex = clampIndex(splitAt, 0, pageCount)
  if (splitIndex === 0) {
    throw new Error('Nothing would remain in the current document.')
  }
  if (splitIndex >= pageCount) {
    throw new Error('Nothing would go to the new document.')
  }

  const beforeIndices = [...Array(splitIndex).keys()]
  const afterIndices = [...Array(pageCount - splitIndex).keys()].map((i) => i + splitIndex)

  const beforeDoc = await PDFDocument.create()
  const afterDoc = await PDFDocument.create()
  const beforePages = await beforeDoc.copyPages(source, beforeIndices)
  const afterPages = await afterDoc.copyPages(source, afterIndices)
  beforePages.forEach((page) => beforeDoc.addPage(page))
  afterPages.forEach((page) => afterDoc.addPage(page))

  return {
    before: await beforeDoc.save({ useObjectStreams: false }),
    after: await afterDoc.save({ useObjectStreams: false }),
  }
}

export async function replacePagesInBytes(
  targetBytes: Uint8Array,
  targetIndices: number[],
  sourceBytes: Uint8Array,
  sourceStartIndex: number,
): Promise<Uint8Array> {
  const dest = await loadPdf(targetBytes)
  const source = await loadPdf(sourceBytes)
  const destCount = dest.getPageCount()
  const sourceCount = source.getPageCount()

  if (destCount === 0 || targetIndices.length === 0) {
    return targetBytes
  }
  if (sourceCount === 0) {
    throw new Error('Source PDF has no pages.')
  }

  const sortedTargets = [...new Set(targetIndices.map((i) => clampIndex(i, 0, destCount - 1)))].sort(
    (a, b) => a - b,
  )
  const needed = sortedTargets.length
  const available = sourceCount - clampIndex(sourceStartIndex, 0, sourceCount - 1)
  if (available < needed) {
    throw new Error('Source PDF does not have enough pages for this replace.')
  }

  const start = clampIndex(sourceStartIndex, 0, sourceCount - 1)
  const sourceIndices = sortedTargets.map((_, offset) => start + offset)
  const copied = await dest.copyPages(source, sourceIndices)

  for (let i = sortedTargets.length - 1; i >= 0; i -= 1) {
    const targetIndex = sortedTargets[i]!
    const replacement = copied[i]!
    dest.removePage(targetIndex)
    dest.insertPage(targetIndex, replacement)
  }

  return dest.save({ useObjectStreams: false })
}

export async function cropPagesInBytes(
  bytes: Uint8Array,
  pageIndices: number[],
  relativeCrop: PageCropRect,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const pageCount = pdf.getPageCount()
  if (pageCount === 0 || pageIndices.length === 0) {
    return bytes
  }

  const crop = normalizeRelativeCrop(relativeCrop)
  const pages = pdf.getPages()
  const unique = [...new Set(pageIndices.map((i) => clampIndex(i, 0, pageCount - 1)))]

  for (const index of unique) {
    const page = pages[index]
    if (!page) {
      continue
    }
    applyRelativeCrop(page, crop)
  }

  return pdf.save({ useObjectStreams: false })
}

function applyRelativeCrop(page: PDFPage, crop: PageCropRect): void {
  const { width, height } = page.getSize()
  const x = crop.left * width
  const y = crop.bottom * height
  const w = crop.width * width
  const h = crop.height * height
  page.setCropBox(x, y, w, h)
}

function normalizeRelativeCrop(crop: PageCropRect): PageCropRect {
  const left = clampFraction(crop.left)
  const bottom = clampFraction(crop.bottom)
  const width = clampFraction(crop.width)
  const height = clampFraction(crop.height)
  return {
    left,
    bottom,
    width: Math.max(0.01, Math.min(1 - left, width)),
    height: Math.max(0.01, Math.min(1 - bottom, height)),
  }
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    if (pdf.isEncrypted) {
      throw new Error('Open that PDF first if it is password-protected.')
    }
    return pdf
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Open that PDF first')) {
      throw error
    }
    if (/encrypt|password|security/i.test(message)) {
      throw new Error('Open that PDF first if it is password-protected.')
    }
    throw new Error(`Could not open PDF for page edits: ${message}`)
  }
}

function clampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
