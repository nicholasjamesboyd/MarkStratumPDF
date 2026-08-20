import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
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
} from '../electron/main/pdf/pageOps'

async function createSizedPdf(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (const [width, height] of sizes) {
    pdf.addPage([width, height])
  }
  return pdf.save({ useObjectStreams: false })
}

async function pageSizes(bytes: Uint8Array): Promise<Array<[number, number]>> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPages().map((page) => {
    const size = page.getSize()
    return [size.width, size.height]
  })
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPageCount()
}

describe('pageOps', () => {
  it('reorders a page with splice semantics', async () => {
    const original = await createSizedPdf([
      [100, 100],
      [200, 100],
      [300, 100],
      [400, 100],
    ])

    const movedRight = await reorderPagesInBytes(original, 0, 2)
    expect(await pageSizes(movedRight)).toEqual([
      [200, 100],
      [300, 100],
      [100, 100],
      [400, 100],
    ])

    const movedLeft = await reorderPagesInBytes(original, 3, 0)
    expect(await pageSizes(movedLeft)).toEqual([
      [400, 100],
      [100, 100],
      [200, 100],
      [300, 100],
    ])
  })

  it('returns original bytes when from and to are the same', async () => {
    const original = await createSizedPdf([
      [100, 100],
      [200, 100],
    ])
    const result = await reorderPagesInBytes(original, 1, 1)
    expect(result).toBe(original)
  })

  it('inserts all source pages at the given index', async () => {
    const target = await createSizedPdf([
      [100, 100],
      [200, 100],
    ])
    const source = await createSizedPdf([
      [50, 50],
      [60, 60],
    ])

    const inserted = await insertPagesFromBytes(target, source, 1)
    expect(await pageSizes(inserted)).toEqual([
      [100, 100],
      [50, 50],
      [60, 60],
      [200, 100],
    ])

    const appended = await insertPagesFromBytes(target, source, 2)
    expect(await pageSizes(appended)).toEqual([
      [100, 100],
      [200, 100],
      [50, 50],
      [60, 60],
    ])
  })

  it('deletes selected pages', async () => {
    const original = await createSizedPdf([
      [100, 100],
      [200, 100],
      [300, 100],
    ])
    const result = await deletePagesInBytes(original, [1])
    expect(await pageSizes(result)).toEqual([
      [100, 100],
      [300, 100],
    ])
  })

  it('blocks deleting every page', async () => {
    const original = await createSizedPdf([[100, 100]])
    await expect(deletePagesInBytes(original, [0])).rejects.toThrow(/at least one page/i)
  })

  it('rotates pages by quarter turns', async () => {
    const original = await createSizedPdf([[100, 200]])
    const rotated = await rotatePagesInBytes(original, [0], 1)
    const pdf = await PDFDocument.load(rotated)
    expect(pdf.getPages()[0]?.getRotation().angle).toBe(90)
  })

  it('inserts a blank page with adjacent size', async () => {
    const original = await createSizedPdf([[400, 500]])
    const result = await insertBlankPageInBytes(original, 1)
    expect(await pageSizes(result)).toEqual([
      [400, 500],
      [400, 500],
    ])
  })

  it('extracts selected pages without changing source semantics', async () => {
    const original = await createSizedPdf([
      [100, 100],
      [200, 100],
      [300, 100],
    ])
    const extracted = await extractPagesToBytes(original, [0, 2])
    expect(await pageSizes(extracted)).toEqual([
      [100, 100],
      [300, 100],
    ])
    expect(await pageCount(original)).toBe(3)
  })

  it('splits a document at the given page index', async () => {
    const original = await createSizedPdf([
      [100, 100],
      [200, 100],
      [300, 100],
    ])
    const { before, after } = await splitDocumentAtPageBytes(original, 2)
    expect(await pageSizes(before)).toEqual([
      [100, 100],
      [200, 100],
    ])
    expect(await pageSizes(after)).toEqual([[300, 100]])
  })

  it('replaces target pages from a source document', async () => {
    const target = await createSizedPdf([
      [100, 100],
      [200, 100],
      [300, 100],
    ])
    const source = await createSizedPdf([
      [50, 50],
      [60, 60],
    ])
    const result = await replacePagesInBytes(target, [0, 2], source, 0)
    expect(await pageSizes(result)).toEqual([
      [50, 50],
      [200, 100],
      [60, 60],
    ])
  })

  it('crops pages using relative coordinates', async () => {
    const original = await createSizedPdf([[200, 200]])
    const result = await cropPagesInBytes(original, [0], {
      left: 0.25,
      bottom: 0.25,
      width: 0.5,
      height: 0.5,
    })
    const pdf = await PDFDocument.load(result)
    const cropBox = pdf.getPages()[0]?.getCropBox()
    expect(cropBox?.x).toBeCloseTo(50)
    expect(cropBox?.y).toBeCloseTo(50)
    expect(cropBox?.width).toBeCloseTo(100)
    expect(cropBox?.height).toBeCloseTo(100)
  })
})
