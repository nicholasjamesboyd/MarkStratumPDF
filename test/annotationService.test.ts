import { PDFDocument, PDFName, PDFDict, PDFRef, PDFArray, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  createAnnotationInBytes,
  deleteAnnotationInBytes,
  listAnnotationsFromBytes,
} from '../electron/main/pdf/annotationService'
import type { MarkupCreateRequest } from '../shared/ipc'

async function createBlankPdf(pageCount = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) {
    pdf.addPage([400, 400])
  }
  return pdf.save({ useObjectStreams: false })
}

function baseRequest(overrides: Partial<MarkupCreateRequest> = {}): MarkupCreateRequest {
  return {
    pageIndex: 0,
    tool: 'line',
    author: 'Ada',
    style: {
      color: [1, 0, 0],
      strokeWidth: 2,
      hatch: 'none',
    },
    points: [
      { x: 40, y: 40 },
      { x: 120, y: 160 },
    ],
    ...overrides,
  }
}

describe('annotationService', () => {
  it('returns an empty list for PDFs without annotations', async () => {
    const bytes = await createBlankPdf()
    expect(await listAnnotationsFromBytes(bytes)).toEqual([])
  })

  it('creates a line markup with author and lists it', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(empty, baseRequest())
    const markups = await listAnnotationsFromBytes(created.bytes)
    expect(markups).toHaveLength(1)
    expect(markups[0]?.id).toBe(created.markupId)
    expect(markups[0]?.tool).toBe('line')
    expect(markups[0]?.author).toBe('Ada')
    expect(markups[0]?.pageIndex).toBe(0)
  })

  it('creates a hatched rectangle and stores hatch metadata', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(
      empty,
      baseRequest({
        tool: 'rectangle',
        style: {
          color: [0, 0.4, 1],
          strokeWidth: 1.5,
          hatch: 'diagonal',
        },
        points: [
          { x: 50, y: 50 },
          { x: 200, y: 150 },
        ],
      }),
    )
    const markups = await listAnnotationsFromBytes(created.bytes)
    expect(markups[0]?.tool).toBe('rectangle')
    expect(markups[0]?.hatch).toBe('diagonal')

    const pdf = await PDFDocument.load(created.bytes)
    const page = pdf.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
    const ref = annots.get(0)
    expect(ref).toBeInstanceOf(PDFRef)
    const dict = pdf.context.lookup(ref as PDFRef, PDFDict)
    expect(dict.lookup(PDFName.of('T'))).toBeInstanceOf(PDFString)
    expect(dict.get(PDFName.of('MarkStratumHatch'))).toEqual(PDFName.of('diagonal'))
    expect(dict.lookup(PDFName.of('AP'), PDFDict)).toBeTruthy()
  })

  it('creates ink and freeText callout markups', async () => {
    const empty = await createBlankPdf()
    const withPen = await createAnnotationInBytes(
      empty,
      baseRequest({
        tool: 'pen',
        author: 'Sam',
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 30 },
          { x: 40, y: 25 },
        ],
      }),
    )
    const withCallout = await createAnnotationInBytes(
      withPen.bytes,
      baseRequest({
        tool: 'callout',
        author: 'Sam',
        style: {
          color: [0, 0, 0],
          strokeWidth: 1,
          hatch: 'none',
          contents: 'Check this',
        },
        points: [
          { x: 80, y: 80 },
          { x: 180, y: 140 },
          { x: 220, y: 200 },
        ],
      }),
    )
    const markups = await listAnnotationsFromBytes(withCallout.bytes)
    expect(markups.map((m) => m.tool).sort()).toEqual(['callout', 'pen'])
    expect(markups.find((m) => m.tool === 'callout')?.contents).toBe('Check this')
    expect(markups.every((m) => m.author === 'Sam')).toBe(true)
  })

  it('deletes a markup by id', async () => {
    const empty = await createBlankPdf()
    const first = await createAnnotationInBytes(empty, baseRequest({ author: 'A' }))
    const second = await createAnnotationInBytes(
      first.bytes,
      baseRequest({
        author: 'B',
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 30 },
        ],
      }),
    )
    let markups = await listAnnotationsFromBytes(second.bytes)
    expect(markups).toHaveLength(2)

    const deleted = await deleteAnnotationInBytes(second.bytes, first.markupId)
    markups = await listAnnotationsFromBytes(deleted)
    expect(markups).toHaveLength(1)
    expect(markups[0]?.id).toBe(second.markupId)
  })

  it('defaults empty author to Unknown', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(empty, baseRequest({ author: '   ' }))
    const markups = await listAnnotationsFromBytes(created.bytes)
    expect(markups[0]?.author).toBe('Unknown')
  })
})
