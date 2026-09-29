import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib'
import type { FormFieldBounds } from '../../../shared/ipc'

const ANNOTS = PDFName.of('Annots')
const RECT = PDFName.of('Rect')
const AP = PDFName.of('AP')
const N = PDFName.of('N')
const RESOURCES = PDFName.of('Resources')
const XOBJECT = PDFName.of('XObject')
const CONTENTS = PDFName.of('Contents')
const TOOL_KEY = PDFName.of('MarkStratumTool')

/**
 * Burn annotation appearances into page content streams and remove the annots.
 * Operates on in-memory bytes only; callers must treat this as a dirty session mutation.
 */
export async function flattenAnnotationsInBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  let flattened = 0

  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(ANNOTS, PDFArray)
    if (!annots || annots.size() === 0) {
      continue
    }

    const toRemove: number[] = []
    const drawOps: string[] = []
    const xobjects: { name: string; ref: PDFRef }[] = []

    for (let i = 0; i < annots.size(); i += 1) {
      const entry = annots.get(i)
      if (!(entry instanceof PDFRef)) {
        continue
      }
      const dict = pdf.context.lookupMaybe(entry, PDFDict)
      if (!dict) {
        continue
      }
      if (!dict.has(TOOL_KEY)) {
        continue
      }
      const bounds = readRect(dict)
      const apRef = appearanceRef(dict, pdf)
      if (!bounds || !apRef) {
        toRemove.push(i)
        continue
      }

      const name = `MsFlat${flattened}`
      flattened += 1
      xobjects.push({ name, ref: apRef })
      drawOps.push('q', `1 0 0 1 ${fmt(bounds.left)} ${fmt(bounds.bottom)} cm`, `/${name} Do`, 'Q')
      toRemove.push(i)
    }

    if (xobjects.length === 0) {
      continue
    }

    ensurePageXObjects(page.node, pdf, xobjects)
    appendPageContent(page.node, pdf, drawOps.join('\n') + '\n')

    for (let i = toRemove.length - 1; i >= 0; i -= 1) {
      annots.remove(toRemove[i]!)
    }
    if (annots.size() === 0) {
      page.node.delete(ANNOTS)
    }
  }

  return pdf.save({ useObjectStreams: false })
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    if (pdf.isEncrypted) {
      throw new Error('Cannot flatten markups in an encrypted PDF yet.')
    }
    return pdf
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/encrypt|password|security/i.test(message)) {
      throw new Error('Cannot flatten markups in an encrypted PDF yet.')
    }
    if (message.startsWith('Cannot flatten')) {
      throw error
    }
    throw new Error(`Could not open PDF for flatten: ${message}`)
  }
}

function appearanceRef(dict: PDFDict, pdf: PDFDocument): PDFRef | null {
  const ap = dict.lookupMaybe(AP, PDFDict)
  if (!ap) {
    return null
  }
  const n = ap.get(N)
  if (n instanceof PDFRef) {
    return n
  }
  if (n instanceof PDFDict) {
    return pdf.context.register(n)
  }
  return null
}

function ensurePageXObjects(
  pageNode: PDFDict,
  pdf: PDFDocument,
  xobjects: { name: string; ref: PDFRef }[],
): void {
  let resources = pageNode.lookupMaybe(RESOURCES, PDFDict)
  if (!resources) {
    resources = pdf.context.obj({}) as PDFDict
    pageNode.set(RESOURCES, resources)
  }
  let xo = resources.lookupMaybe(XOBJECT, PDFDict)
  if (!xo) {
    xo = pdf.context.obj({}) as PDFDict
    resources.set(XOBJECT, xo)
  }
  for (const item of xobjects) {
    xo.set(PDFName.of(item.name), item.ref)
  }
}

function appendPageContent(pageNode: PDFDict, pdf: PDFDocument, ops: string): void {
  const stream = pdf.context.flateStream(ops)
  const streamRef = pdf.context.register(stream)
  const existing = pageNode.lookup(CONTENTS)
  if (!existing) {
    pageNode.set(CONTENTS, streamRef)
    return
  }
  if (existing instanceof PDFRef) {
    const arr = pdf.context.obj([existing, streamRef]) as PDFArray
    pageNode.set(CONTENTS, arr)
    return
  }
  if (existing instanceof PDFArray) {
    existing.push(streamRef)
    return
  }
  // Rare: inline stream object
  if (existing instanceof PDFRawStream || existing instanceof PDFDict) {
    const arr = pdf.context.obj([pdf.context.register(existing), streamRef]) as PDFArray
    pageNode.set(CONTENTS, arr)
    return
  }
  pageNode.set(CONTENTS, streamRef)
}

function readRect(dict: PDFDict): FormFieldBounds | null {
  const rect = dict.lookup(RECT)
  if (!(rect instanceof PDFArray) || rect.size() < 4) {
    return null
  }
  const nums = [0, 1, 2, 3].map((i) => {
    const v = rect.get(i)
    return v instanceof PDFNumber ? v.asNumber() : null
  })
  if (nums.some((n) => n === null)) {
    return null
  }
  const [x0, y0, x1, y1] = nums as number[]
  return {
    left: Math.min(x0, x1),
    bottom: Math.min(y0, y1),
    right: Math.max(x0, x1),
    top: Math.max(y0, y1),
  }
}

function fmt(n: number): string {
  return n.toFixed(2)
}
