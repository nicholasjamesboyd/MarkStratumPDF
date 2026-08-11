import { rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib'

export type FormValueMap = Record<string, string>

/**
 * Writes AcroForm field values into a PDF and keeps widgets fillable.
 * Appearances are regenerated so rendered values match stored /V.
 */
export async function writeFormValues(
  sourcePath: string,
  destPath: string,
  values: FormValueMap,
): Promise<void> {
  let bytes: Uint8Array
  try {
    bytes = readFileSync(sourcePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not read PDF for save: ${message}`)
  }

  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/encrypt|password|security/i.test(message)) {
      throw new Error('Cannot save form values into an encrypted PDF yet.')
    }
    throw new Error(`Could not open PDF for save: ${message}`)
  }

  if (pdf.isEncrypted) {
    throw new Error('Cannot save form values into an encrypted PDF yet.')
  }

  const form = pdf.getForm()
  for (const [name, value] of Object.entries(values)) {
    applyFieldValue(form, name, value)
  }

  form.updateFieldAppearances()
  const saved = await pdf.save({ updateFieldAppearances: true })

  const dir = dirname(destPath)
  const tempPath = join(dir, `.markstratum-save-${randomBytes(8).toString('hex')}.pdf`)
  try {
    await writeFile(tempPath, saved)
    try {
      await rename(tempPath, destPath)
    } catch {
      // Windows cannot rename over an existing file.
      await unlink(destPath)
      await rename(tempPath, destPath)
    }
  } catch (error) {
    try {
      await unlink(tempPath)
    } catch {
      // ignore cleanup failures
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not write saved PDF: ${message}`)
  }
}

function applyFieldValue(
  form: ReturnType<PDFDocument['getForm']>,
  name: string,
  value: string,
): void {
  let field
  try {
    field = form.getField(name)
  } catch {
    // Field may have been removed or renamed; skip quietly.
    return
  }

  if (field instanceof PDFTextField) {
    field.setText(value)
    return
  }

  if (field instanceof PDFCheckBox) {
    if (value === 'true' || value === 'Yes' || value === 'On' || value === '1') {
      field.check()
    } else {
      field.uncheck()
    }
    return
  }

  if (field instanceof PDFRadioGroup) {
    if (!value) {
      field.clear()
      return
    }
    try {
      field.select(value)
    } catch {
      // Invalid option for this group.
    }
    return
  }

  if (field instanceof PDFDropdown) {
    if (!value) {
      field.clear()
      return
    }
    try {
      field.select(value)
    } catch {
      // Invalid option.
    }
    return
  }

  if (field instanceof PDFOptionList) {
    if (!value) {
      field.clear()
      return
    }
    try {
      field.select(value)
    } catch {
      // Invalid option.
    }
  }
}
