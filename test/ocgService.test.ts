import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  createLayerInBytes,
  deleteLayerInBytes,
  listLayersFromBytes,
  renameLayerInBytes,
  setLayerVisibilityInBytes,
} from '../electron/main/pdf/ocgService'

async function createLayeredPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([300, 200])

  const context = pdf.context
  const ocgA = context.obj({ Type: 'OCG', Name: 'Annotations', Intent: 'View' })
  const ocgB = context.obj({ Type: 'OCG', Name: 'Dimensions', Intent: 'View' })
  const refA = context.register(ocgA)
  const refB = context.register(ocgB)

  const order = context.obj([
    [PDFString.of('Drawing'), refA, refB],
  ])
  const config = context.obj({
    Name: 'Default',
    BaseState: 'ON',
    ON: [],
    OFF: [refB],
    Order: order,
  })
  const ocProperties = context.obj({
    OCGs: [refA, refB],
    D: config,
  })
  pdf.catalog.set(PDFName.of('OCProperties'), ocProperties)

  return pdf.save({ useObjectStreams: false })
}

describe('ocgService', () => {
  it('lists layers with Order grouping and BaseState visibility', async () => {
    const bytes = await createLayeredPdf()
    const layers = await listLayersFromBytes(bytes)
    expect(layers).toHaveLength(1)
    expect(layers[0].name).toBe('Drawing')
    expect(layers[0].children).toHaveLength(2)
    expect(layers[0].children![0].name).toBe('Annotations')
    expect(layers[0].children![0].visible).toBe(true)
    expect(layers[0].children![1].name).toBe('Dimensions')
    expect(layers[0].children![1].visible).toBe(false)
  })

  it('toggles layer visibility in the default config', async () => {
    const bytes = await createLayeredPdf()
    const before = await listLayersFromBytes(bytes)
    const dimensions = before[0].children![1]
    expect(dimensions.visible).toBe(false)

    const toggled = await setLayerVisibilityInBytes(bytes, dimensions.id, true)
    const after = await listLayersFromBytes(toggled)
    const updated = after[0].children!.find((layer) => layer.name === 'Dimensions')
    expect(updated?.visible).toBe(true)
  })

  it('creates, renames, and deletes layers', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([200, 200])
    const empty = await pdf.save({ useObjectStreams: false })

    const created = await createLayerInBytes(empty, 'Markup', true)
    let layers = await listLayersFromBytes(created.bytes)
    expect(layers.some((layer) => layer.name === 'Markup')).toBe(true)

    const renamed = await renameLayerInBytes(created.bytes, created.layerId, 'Redlines')
    layers = await listLayersFromBytes(renamed)
    expect(layers.some((layer) => layer.name === 'Redlines')).toBe(true)
    expect(layers.some((layer) => layer.name === 'Markup')).toBe(false)

    const deleted = await deleteLayerInBytes(renamed, created.layerId)
    layers = await listLayersFromBytes(deleted)
    expect(layers.some((layer) => layer.id === created.layerId)).toBe(false)
  })

  it('returns an empty list for PDFs without OCProperties', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([100, 100])
    const bytes = await pdf.save()
    expect(await listLayersFromBytes(bytes)).toEqual([])
  })

  it('round-trips through a temp file for session-style reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'markstratum-ocg-'))
    const path = join(dir, 'layers.pdf')
    const bytes = await createLayeredPdf()
    writeFileSync(path, bytes)

    const { readFileSync } = await import('node:fs')
    const loaded = readFileSync(path)
    const layers = await listLayersFromBytes(loaded)
    const id = layers[0].children![0].id
    const next = await setLayerVisibilityInBytes(loaded, id, false)
    writeFileSync(path, next)
    const after = await listLayersFromBytes(readFileSync(path))
    expect(after[0].children![0].visible).toBe(false)
  })
})
