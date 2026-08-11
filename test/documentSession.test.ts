import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
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

async function writeFillablePdf(filePath: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([400, 300])
  const form = pdf.getForm()
  const name = form.createTextField('FullName')
  name.addToPage(page, { x: 40, y: 200, width: 200, height: 24 })
  name.setText('Initial')
  const agree = form.createCheckBox('Agree')
  agree.addToPage(page, { x: 40, y: 160, width: 18, height: 18 })
  const bytes = await pdf.save()
  writeFileSync(filePath, bytes)
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

describe('DocumentSession form save', () => {
  it('persists form values on save and keeps the same documentId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'markstratum-session-form-'))
    const filePath = join(dir, 'form.pdf')
    await writeFillablePdf(filePath)

    const session = new DocumentSession()
    const opened = await session.open(filePath)
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }

    const documentId = opened.document.documentId
    const fieldsBefore = await session.getFormFields(documentId)
    expect(fieldsBefore.some((field) => field.name === 'FullName')).toBe(true)

    const updated = await session.setFormValues(documentId, [
      { name: 'FullName', value: 'Katherine Johnson' },
      { name: 'Agree', value: 'true' },
    ])
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.document.dirty).toBe(true)
    }

    const saved = await session.save(documentId)
    expect(saved.ok).toBe(true)
    if (!saved.ok) {
      return
    }
    expect(saved.document.documentId).toBe(documentId)
    expect(saved.document.dirty).toBe(false)

    const fieldsAfter = await session.getFormFields(documentId)
    const nameField = fieldsAfter.find((field) => field.name === 'FullName')
    const agreeField = fieldsAfter.find((field) => field.name === 'Agree')
    expect(nameField?.value).toBe('Katherine Johnson')
    expect(agreeField?.isChecked).toBe(true)

    const onDisk = await PDFDocument.load(readFileSync(filePath))
    expect(onDisk.getForm().getTextField('FullName').getText()).toBe('Katherine Johnson')
    expect(onDisk.getForm().getCheckBox('Agree').isChecked()).toBe(true)

    await session.close()
  })

  it('saveAs writes a new path and updates document info', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'markstratum-session-saveas-'))
    const source = join(dir, 'form.pdf')
    const dest = join(dir, 'copy.pdf')
    await writeFillablePdf(source)

    const session = new DocumentSession()
    const opened = await session.open(source)
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }

    await session.setFormValues(opened.document.documentId, [
      { name: 'FullName', value: 'Saved As Name' },
    ])
    const result = await session.saveAs(opened.document.documentId, dest)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.document.path).toBe(dest)
    expect(result.document.fileName).toBe('copy.pdf')
    expect(result.document.dirty).toBe(false)
    expect(result.document.documentId).toBe(opened.document.documentId)

    const onDisk = await PDFDocument.load(readFileSync(dest))
    expect(onDisk.getForm().getTextField('FullName').getText()).toBe('Saved As Name')

    await session.close()
  })
})
