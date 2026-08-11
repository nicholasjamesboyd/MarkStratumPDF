import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { writeFormValues } from '../electron/main/pdf/formWriter'

async function createFillablePdf(filePath: string) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([400, 300])
  const form = pdf.getForm()

  const name = form.createTextField('FullName')
  name.addToPage(page, { x: 50, y: 220, width: 200, height: 24 })
  name.setText('')

  const agree = form.createCheckBox('Agree')
  agree.addToPage(page, { x: 50, y: 180, width: 18, height: 18 })

  const color = form.createDropdown('Color')
  color.addOptions(['Red', 'Green', 'Blue'])
  color.addToPage(page, { x: 50, y: 140, width: 120, height: 24 })
  color.select('Red')

  const bytes = await pdf.save()
  const { writeFileSync } = await import('node:fs')
  writeFileSync(filePath, bytes)
}

describe('writeFormValues', () => {
  it('writes text and checkbox values and keeps the form fillable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'markstratum-form-'))
    const source = join(dir, 'form.pdf')
    const dest = join(dir, 'filled.pdf')
    await createFillablePdf(source)

    await writeFormValues(source, dest, {
      FullName: 'Ada Lovelace',
      Agree: 'true',
      Color: 'Blue',
    })

    const loaded = await PDFDocument.load(readFileSync(dest))
    const form = loaded.getForm()
    expect(form.getTextField('FullName').getText()).toBe('Ada Lovelace')
    expect(form.getCheckBox('Agree').isChecked()).toBe(true)
    expect(form.getDropdown('Color').getSelected()).toEqual(['Blue'])
    expect(form.getFields().length).toBeGreaterThanOrEqual(3)
  })

  it('can overwrite the source path in place', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'markstratum-form-inplace-'))
    const path = join(dir, 'form.pdf')
    await createFillablePdf(path)

    await writeFormValues(path, path, {
      FullName: 'Grace Hopper',
      Agree: 'false',
      Color: 'Green',
    })

    const loaded = await PDFDocument.load(readFileSync(path))
    const form = loaded.getForm()
    expect(form.getTextField('FullName').getText()).toBe('Grace Hopper')
    expect(form.getCheckBox('Agree').isChecked()).toBe(false)
    expect(form.getDropdown('Color').getSelected()).toEqual(['Green'])
  })
})
