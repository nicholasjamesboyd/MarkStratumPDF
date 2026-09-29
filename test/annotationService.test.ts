import { PDFDocument, PDFName, PDFDict, PDFRef, PDFArray, PDFString, PDFNumber } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  createAnnotationInBytes,
  deleteAnnotationInBytes,
  listAnnotationsFromBytes,
  updateAnnotationInBytes,
} from '../electron/main/pdf/annotationService'
import { flattenAnnotationsInBytes } from '../electron/main/pdf/flattenService'
import { createLayerInBytes } from '../electron/main/pdf/ocgService'
import {
  CALLOUT_BOX_GAP,
  boxSideAnchor,
  calloutBoxCorners,
  cloudPolylineFromPolygon,
  sampleArc,
} from '../shared/markupGeometry'
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

describe('markupGeometry', () => {
  it('samples a curved arc with many points', () => {
    const pts = sampleArc([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 40 },
    ])
    expect(pts.length).toBeGreaterThan(10)
  })

  it('builds a scalloped cloud polyline longer than the source polygon', () => {
    const cloud = cloudPolylineFromPolygon([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ])
    expect(cloud.length).toBeGreaterThan(8)
  })

  it('anchors a leader on the box edge facing the target', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 50 }
    expect(boxSideAnchor(a, b, { x: 400, y: 25 })).toEqual({ x: 100, y: 25 })
    expect(boxSideAnchor(a, b, { x: -400, y: 25 })).toEqual({ x: 0, y: 25 })
    expect(boxSideAnchor(a, b, { x: 50, y: 400 })).toEqual({ x: 50, y: 50 })
    expect(boxSideAnchor(a, b, { x: 50, y: -400 })).toEqual({ x: 50, y: 0 })
  })

  it('holds the default callout box clear of the cursor, opposite the tip', () => {
    const cursor = { x: 200, y: 200 }

    const [leftA, leftB] = calloutBoxCorners(cursor, { x: 20, y: 200 }, 100, 40)
    expect(leftA.x).toBeGreaterThan(cursor.x)
    expect(leftB.x).toBeGreaterThan(cursor.x)
    expect(boxSideAnchor(leftA, leftB, { x: 20, y: 200 })).toEqual({
      x: cursor.x + CALLOUT_BOX_GAP,
      y: cursor.y,
    })

    const [belowA, belowB] = calloutBoxCorners(cursor, { x: 200, y: 500 }, 100, 40)
    expect(belowA.y).toBeLessThan(cursor.y)
    expect(belowB.y).toBeLessThan(cursor.y)
    expect(boxSideAnchor(belowA, belowB, { x: 200, y: 500 })).toEqual({
      x: cursor.x,
      y: cursor.y - CALLOUT_BOX_GAP,
    })
  })
})

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
    expect(markups[0]?.hatchScale).toBe(1)
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
          hatchScale: 2,
          hatchColor: [0, 1, 0],
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
    expect(markups[0]?.hatchScale).toBe(2)
    expect(markups[0]?.hatchColor).toEqual([0, 1, 0])

    const pdf = await PDFDocument.load(created.bytes)
    const page = pdf.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
    const ref = annots.get(0)
    expect(ref).toBeInstanceOf(PDFRef)
    const dict = pdf.context.lookup(ref as PDFRef, PDFDict)
    expect(dict.lookup(PDFName.of('T'))).toBeInstanceOf(PDFString)
    expect(dict.get(PDFName.of('MarkStratumHatch'))).toEqual(PDFName.of('diagonal'))
    expect(dict.lookup(PDFName.of('MarkStratumHatchScale'))).toBeInstanceOf(PDFNumber)
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

  it('keeps a callout text box and tip where they were placed', async () => {
    const empty = await createBlankPdf()
    const points = [
      { x: 80, y: 80 },
      { x: 180, y: 140 },
      { x: 320, y: 300 },
    ]
    const created = await createAnnotationInBytes(
      empty,
      baseRequest({ tool: 'callout', points }),
    )

    const markups = await listAnnotationsFromBytes(created.bytes)
    expect(markups[0]?.points).toEqual(points)

    const pdf = await PDFDocument.load(created.bytes)
    const page = pdf.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
    const dict = pdf.context.lookup(annots.get(0) as PDFRef, PDFDict)
    const rd = dict.lookup(PDFName.of('RD'))
    expect(rd).toBeInstanceOf(PDFArray)
    expect((rd as PDFArray).size()).toBe(4)
  })

  it('attaches a callout leader to the box edge facing the tip', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(
      empty,
      baseRequest({
        tool: 'callout',
        points: [
          { x: 80, y: 80 },
          { x: 180, y: 140 },
          { x: 340, y: 100 },
        ],
      }),
    )

    const pdf = await PDFDocument.load(created.bytes)
    const page = pdf.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
    const dict = pdf.context.lookup(annots.get(0) as PDFRef, PDFDict)
    const cl = dict.lookup(PDFName.of('CL')) as PDFArray
    // Box centre is (130, 110) and the tip sits to the right, so the leader meets the right edge.
    expect([0, 1, 2, 3].map((i) => (cl.get(i) as PDFNumber).asNumber())).toEqual([180, 110, 340, 100])
  })

  it('attaches a cloud callout leader to the text box edge facing the cloud', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(
      empty,
      baseRequest({
        tool: 'cloudCallout',
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 200 },
          { x: 400, y: 150 },
          { x: 500, y: 190 },
        ],
      }),
    )

    const pdf = await PDFDocument.load(created.bytes)
    const page = pdf.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
    const dict = pdf.context.lookup(annots.get(0) as PDFRef, PDFDict)
    const cl = dict.lookup(PDFName.of('CL')) as PDFArray
    // Text box centre is (450, 170), so the leader meets its left edge centre (400, 170),
    // and the cloud centre is (150, 150), so it meets the cloud's right edge centre (200, 150).
    expect([0, 1, 2, 3].map((i) => (cl.get(i) as PDFNumber).asNumber())).toEqual([400, 170, 200, 150])
  })

  it('updates a markup in place and keeps the id', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(empty, baseRequest())
    const updated = await updateAnnotationInBytes(created.bytes, {
      id: created.markupId,
      style: { color: [0, 1, 0], strokeWidth: 4 },
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
    })
    const markups = await listAnnotationsFromBytes(updated)
    expect(markups).toHaveLength(1)
    expect(markups[0]?.id).toBe(created.markupId)
    expect(markups[0]?.color).toEqual([0, 1, 0])
    expect(markups[0]?.strokeWidth).toBe(4)
    expect(markups[0]?.points[0]).toEqual({ x: 10, y: 10 })
  })

  it('assigns a markup to an OCG layer', async () => {
    const empty = await createBlankPdf()
    const withLayer = await createLayerInBytes(empty, 'Markup Layer')
    const created = await createAnnotationInBytes(
      withLayer.bytes,
      baseRequest({ layerId: withLayer.layerId }),
    )
    const markups = await listAnnotationsFromBytes(created.bytes)
    expect(markups[0]?.layerId).toBe(withLayer.layerId)

    const pdf = await PDFDocument.load(created.bytes)
    const page = pdf.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
    const ref = annots.get(0) as PDFRef
    const dict = pdf.context.lookup(ref, PDFDict)
    expect(dict.get(PDFName.of('OC'))).toBeInstanceOf(PDFRef)
  })

  it('creates a cloud with appearance stream', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(
      empty,
      baseRequest({
        tool: 'cloud',
        points: [
          { x: 40, y: 40 },
          { x: 160, y: 40 },
          { x: 160, y: 120 },
          { x: 40, y: 120 },
        ],
      }),
    )
    const markups = await listAnnotationsFromBytes(created.bytes)
    expect(markups[0]?.tool).toBe('cloud')
    const pdf = await PDFDocument.load(created.bytes)
    const page = pdf.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray)
    const dict = pdf.context.lookup(annots.get(0) as PDFRef, PDFDict)
    expect(dict.lookup(PDFName.of('AP'), PDFDict)).toBeTruthy()
  })

  it('flattens markups into page content and removes annots', async () => {
    const empty = await createBlankPdf()
    const created = await createAnnotationInBytes(
      empty,
      baseRequest({
        tool: 'rectangle',
        points: [
          { x: 50, y: 50 },
          { x: 150, y: 120 },
        ],
      }),
    )
    expect(await listAnnotationsFromBytes(created.bytes)).toHaveLength(1)
    const flattened = await flattenAnnotationsInBytes(created.bytes)
    expect(await listAnnotationsFromBytes(flattened)).toHaveLength(0)

    const pdf = await PDFDocument.load(flattened)
    const page = pdf.getPage(0)
    expect(page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)).toBeUndefined()
    expect(page.node.lookup(PDFName.of('Contents'))).toBeTruthy()
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
