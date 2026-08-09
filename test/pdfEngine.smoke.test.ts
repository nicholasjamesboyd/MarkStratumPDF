import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PdfiumEngine } from '../electron/main/pdf/pdfEngine'

function writeMinimalPdf(filePath: string) {
  const content = `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 72 72 Td (RedColumn) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000361 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
433
%%EOF
`
  writeFileSync(filePath, content, 'utf8')
}

describe('PdfiumEngine smoke', () => {
  it('opens and renders a page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redcolumn-'))
    const filePath = join(dir, 'sample.pdf')
    writeMinimalPdf(filePath)

    const engine = new PdfiumEngine()
    const doc = await engine.open(filePath)
    expect(engine.getPageCount(doc)).toBe(1)

    const pages = await engine.getPages(doc)
    expect(pages[0]?.width).toBeGreaterThan(0)

    const rendered = await engine.renderPage(doc, {
      pageIndex: 0,
      scale: 1,
      requestId: 'smoke-1',
    })
    expect(rendered.data.byteLength).toBeGreaterThan(100)
    expect(rendered.mimeType).toBe('image/jpeg')

    await engine.close(doc)
  })
})
