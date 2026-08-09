import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../electron/main/pdf/documentSession'

function writeMinimalPdf(filePath: string, label: string) {
  const content = `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 72 72 Td (${label}) Tj ET
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

describe('DocumentSession multi-doc', () => {
  it('keeps multiple documents open and renders by documentId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'markstratum-session-'))
    const firstPath = join(dir, 'a.pdf')
    const secondPath = join(dir, 'b.pdf')
    writeMinimalPdf(firstPath, 'DocA')
    writeMinimalPdf(secondPath, 'DocB')

    const session = new DocumentSession()
    const first = await session.open(firstPath)
    const second = await session.open(secondPath)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }

    expect(first.document.documentId).not.toBe(second.document.documentId)
    expect(session.documentIds).toHaveLength(2)

    const rendered = await session.renderPage({
      documentId: first.document.documentId,
      pageIndex: 0,
      scale: 1,
      requestId: 'tab-1',
    })
    expect(rendered.dataBase64.length).toBeGreaterThan(20)

    const again = await session.open(firstPath)
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.document.documentId).toBe(first.document.documentId)
    }
    expect(session.documentIds).toHaveLength(2)

    await session.close(first.document.documentId)
    expect(session.documentIds).toEqual([second.document.documentId])

    await session.close()
    expect(session.documentIds).toHaveLength(0)
  })
})
