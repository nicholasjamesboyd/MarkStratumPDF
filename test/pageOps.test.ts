import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { insertPagesFromBytes, reorderPagesInBytes } from '../electron/main/pdf/pageOps'

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
})
