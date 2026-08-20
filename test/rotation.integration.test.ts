import { PDFDocument } from 'pdf-lib'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PdfiumEngine } from '../electron/main/pdf/pdfEngine'
import { rotatePagesInBytes } from '../electron/main/pdf/pageOps'

async function createPortraitPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([200, 400])
  return pdf.save({ useObjectStreams: false })
}

describe('rotation integration', () => {
  it('applies PDF rotation once and reports landscape pixel output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'markstratum-rot-'))
    const filePath = join(dir, 'rotated.pdf')
    const original = await createPortraitPdf()
    const rotated = await rotatePagesInBytes(original, [0], 1)
    writeFileSync(filePath, rotated)

    const engine = new PdfiumEngine()
    const doc = await engine.open(filePath)
    try {
      const pages = await engine.getPages(doc)
      const page = pages[0]!

      expect(page.width).toBeCloseTo(400, 0)
      expect(page.height).toBeCloseTo(200, 0)
      expect(page.rotation).toBe(1)

      const rendered = await engine.renderPage(doc, {
        pageIndex: 0,
        scale: 0.5,
        requestId: 'native-rot',
      })

      expect(rendered.width).toBeGreaterThan(rendered.height)
    } finally {
      await engine.close(doc)
    }
  })

  it('pdf-lib rotation angle is in degrees', async () => {
    const original = await createPortraitPdf()
    const rotated = await rotatePagesInBytes(original, [0], 1)
    const pdf = await PDFDocument.load(rotated)
    expect(pdf.getPages()[0]?.getRotation().angle).toBe(90)
  })
})
