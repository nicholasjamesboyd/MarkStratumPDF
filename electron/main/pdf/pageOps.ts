import { PDFDocument } from 'pdf-lib'

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
