import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFObject,
} from 'pdf-lib'
import type { LayerInfo } from '../../../shared/ipc'

const OC_PROPERTIES = PDFName.of('OCProperties')
const OCGS = PDFName.of('OCGs')
const DEFAULT_CONFIG = PDFName.of('D')
const BASE_STATE = PDFName.of('BaseState')
const ON = PDFName.of('ON')
const OFF = PDFName.of('OFF')
const ORDER = PDFName.of('Order')
const TYPE = PDFName.of('Type')
const OCG_TYPE = PDFName.of('OCG')
const NAME = PDFName.of('Name')

export async function listLayersFromBytes(bytes: Uint8Array): Promise<LayerInfo[]> {
  const pdf = await loadPdf(bytes)
  return listLayers(pdf)
}

export async function setLayerVisibilityInBytes(
  bytes: Uint8Array,
  layerId: string,
  visible: boolean,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const ref = findOcgRef(pdf, layerId)
  if (!ref) {
    throw new Error(`Layer not found: ${layerId}`)
  }
  const { config } = ensureOcProperties(pdf)
  setOcgVisibility(config, ref, visible)
  return pdf.save({ useObjectStreams: false })
}

export async function createLayerInBytes(
  bytes: Uint8Array,
  name: string,
  visible = true,
): Promise<{ bytes: Uint8Array; layerId: string }> {
  const pdf = await loadPdf(bytes)
  const trimmed = name.trim() || 'Layer'
  const { ocProperties, config, ocgs } = ensureOcProperties(pdf)

  const ocgDict = pdf.context.obj({
    Type: 'OCG',
    Name: trimmed,
    Intent: 'View',
  }) as PDFDict
  const ocgRef = pdf.context.register(ocgDict)

  ocgs.push(ocgRef)
  appendToOrder(config, ocgRef)
  setOcgVisibility(config, ocgRef, visible)

  pdf.catalog.set(OC_PROPERTIES, ocProperties)

  const saved = await pdf.save({ useObjectStreams: false })
  return { bytes: saved, layerId: refId(ocgRef) }
}

export async function renameLayerInBytes(
  bytes: Uint8Array,
  layerId: string,
  name: string,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const ref = findOcgRef(pdf, layerId)
  if (!ref) {
    throw new Error(`Layer not found: ${layerId}`)
  }
  const dict = pdf.context.lookup(ref, PDFDict)
  dict.set(NAME, PDFString.of(name.trim() || 'Layer'))
  return pdf.save({ useObjectStreams: false })
}

export async function deleteLayerInBytes(bytes: Uint8Array, layerId: string): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const ref = findOcgRef(pdf, layerId)
  if (!ref) {
    throw new Error(`Layer not found: ${layerId}`)
  }

  const ocProperties = pdf.catalog.lookupMaybe(OC_PROPERTIES, PDFDict)
  if (!ocProperties) {
    return bytes
  }

  const ocgs = ocProperties.lookupMaybe(OCGS, PDFArray)
  if (ocgs) {
    removeRefFromArray(ocgs, ref)
  }

  const config = ocProperties.lookupMaybe(DEFAULT_CONFIG, PDFDict)
  if (config) {
    const on = config.lookupMaybe(ON, PDFArray)
    const off = config.lookupMaybe(OFF, PDFArray)
    const order = config.lookupMaybe(ORDER, PDFArray)
    if (on) {
      removeRefFromArray(on, ref)
    }
    if (off) {
      removeRefFromArray(off, ref)
    }
    if (order) {
      removeRefFromOrder(order, ref)
    }
  }

  return pdf.save({ useObjectStreams: false })
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    if (pdf.isEncrypted) {
      throw new Error('Cannot edit layers in an encrypted PDF yet.')
    }
    return pdf
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/encrypt|password|security/i.test(message)) {
      throw new Error('Cannot edit layers in an encrypted PDF yet.')
    }
    if (message.startsWith('Cannot edit layers')) {
      throw error
    }
    throw new Error(`Could not open PDF for layers: ${message}`)
  }
}

function listLayers(pdf: PDFDocument): LayerInfo[] {
  const ocProperties = pdf.catalog.lookupMaybe(OC_PROPERTIES, PDFDict)
  if (!ocProperties) {
    return []
  }

  const ocgs = collectOcgs(pdf, ocProperties)
  if (ocgs.size === 0) {
    return []
  }

  const config = ocProperties.lookupMaybe(DEFAULT_CONFIG, PDFDict)
  const visibility = buildVisibilityMap(config, ocgs)
  const order = config?.lookupMaybe(ORDER, PDFArray)
  const seen = new Set<string>()

  const roots: LayerInfo[] = []
  if (order) {
    roots.push(...walkOrder(pdf, order, visibility, seen, 0))
  }

  for (const [id, entry] of ocgs) {
    if (seen.has(id)) {
      continue
    }
    roots.push({
      id,
      name: entry.name,
      visible: visibility.get(id) ?? true,
      depth: 0,
    })
  }

  return roots
}

type OcgEntry = {
  ref: PDFRef
  name: string
  dict: PDFDict
}

function collectOcgs(pdf: PDFDocument, ocProperties: PDFDict): Map<string, OcgEntry> {
  const result = new Map<string, OcgEntry>()
  const ocgs = ocProperties.lookupMaybe(OCGS, PDFArray)
  if (!ocgs) {
    return result
  }

  for (let i = 0; i < ocgs.size(); i += 1) {
    const raw = ocgs.get(i)
    if (!(raw instanceof PDFRef)) {
      continue
    }
    const dict = pdf.context.lookupMaybe(raw, PDFDict)
    if (!dict || !isOcgDict(dict)) {
      continue
    }
    const id = refId(raw)
    result.set(id, {
      ref: raw,
      name: readName(dict) || `Layer ${id}`,
      dict,
    })
  }
  return result
}

function isOcgDict(dict: PDFDict): boolean {
  const type = dict.lookupMaybe(TYPE, PDFName)
  // Some producers omit /Type on OCG dictionaries.
  return !type || type === OCG_TYPE
}

function buildVisibilityMap(
  config: PDFDict | undefined,
  ocgs: Map<string, OcgEntry>,
): Map<string, boolean> {
  const visibility = new Map<string, boolean>()
  const baseOn = readBaseStateOn(config)
  const onIds = arrayRefIds(config?.lookupMaybe(ON, PDFArray))
  const offIds = arrayRefIds(config?.lookupMaybe(OFF, PDFArray))

  for (const id of ocgs.keys()) {
    if (baseOn) {
      visibility.set(id, !offIds.has(id))
    } else {
      visibility.set(id, onIds.has(id))
    }
  }
  return visibility
}

function readBaseStateOn(config: PDFDict | undefined): boolean {
  if (!config) {
    return true
  }
  const base = config.lookupMaybe(BASE_STATE, PDFName)
  if (!base) {
    return true
  }
  return base.decodeText() !== 'OFF'
}

function arrayRefIds(array: PDFArray | undefined): Set<string> {
  const ids = new Set<string>()
  if (!array) {
    return ids
  }
  for (let i = 0; i < array.size(); i += 1) {
    const item = array.get(i)
    if (item instanceof PDFRef) {
      ids.add(refId(item))
    }
  }
  return ids
}

function walkOrder(
  pdf: PDFDocument,
  order: PDFArray,
  visibility: Map<string, boolean>,
  seen: Set<string>,
  depth: number,
): LayerInfo[] {
  const nodes: LayerInfo[] = []
  for (let index = 0; index < order.size(); index += 1) {
    const item = order.get(index)

    if (item instanceof PDFRef) {
      const node = layerFromRef(pdf, item, visibility, seen, depth)
      if (node) {
        nodes.push(node)
      }
      continue
    }

    if (!(item instanceof PDFArray)) {
      continue
    }

    // Labelled group: [ (Name) ocg1 ocg2 ... ] per PDF Order arrays.
    const first = item.size() > 0 ? item.get(0) : undefined
    const firstResolved = first ? pdf.context.lookup(first) : undefined
    if (first && isNameLike(firstResolved ?? first) && !(first instanceof PDFRef)) {
      const label = decodePdfText(firstResolved ?? first)
      const children: LayerInfo[] = []
      for (let childIndex = 1; childIndex < item.size(); childIndex += 1) {
        const child = item.get(childIndex)
        if (child instanceof PDFRef) {
          const node = layerFromRef(pdf, child, visibility, seen, depth + 1)
          if (node) {
            children.push(node)
          }
          continue
        }
        if (child instanceof PDFArray) {
          children.push(...walkOrder(pdf, child, visibility, seen, depth + 1))
        }
      }
      if (children.length > 0) {
        nodes.push({
          id: `group:${depth}:${label}:${nodes.length}`,
          name: label || 'Group',
          visible: children.every((child) => child.visible),
          depth,
          children,
        })
      }
      continue
    }

    nodes.push(...walkOrder(pdf, item, visibility, seen, depth))
  }
  return nodes
}

function layerFromRef(
  pdf: PDFDocument,
  ref: PDFRef,
  visibility: Map<string, boolean>,
  seen: Set<string>,
  depth: number,
): LayerInfo | null {
  const id = refId(ref)
  if (seen.has(id)) {
    return null
  }
  const dict = pdf.context.lookupMaybe(ref, PDFDict)
  if (!dict || !isOcgDict(dict)) {
    return null
  }
  seen.add(id)
  return {
    id,
    name: readName(dict) || `Layer ${id}`,
    visible: visibility.get(id) ?? true,
    depth,
  }
}

function ensureOcProperties(pdf: PDFDocument): {
  ocProperties: PDFDict
  config: PDFDict
  ocgs: PDFArray
} {
  let ocProperties = pdf.catalog.lookupMaybe(OC_PROPERTIES, PDFDict)
  if (!ocProperties) {
    ocProperties = pdf.context.obj({}) as PDFDict
    pdf.catalog.set(OC_PROPERTIES, ocProperties)
  }

  let ocgs = ocProperties.lookupMaybe(OCGS, PDFArray)
  if (!ocgs) {
    ocgs = pdf.context.obj([]) as PDFArray
    ocProperties.set(OCGS, ocgs)
  }

  let config = ocProperties.lookupMaybe(DEFAULT_CONFIG, PDFDict)
  if (!config) {
    config = pdf.context.obj({
      Name: PDFString.of('Default'),
      BaseState: PDFName.of('ON'),
      ON: pdf.context.obj([]),
      OFF: pdf.context.obj([]),
      Order: pdf.context.obj([]),
    }) as PDFDict
    ocProperties.set(DEFAULT_CONFIG, config)
  }

  if (!config.lookupMaybe(BASE_STATE, PDFName)) {
    config.set(BASE_STATE, PDFName.of('ON'))
  }
  if (!config.lookupMaybe(ON, PDFArray)) {
    config.set(ON, pdf.context.obj([]))
  }
  if (!config.lookupMaybe(OFF, PDFArray)) {
    config.set(OFF, pdf.context.obj([]))
  }
  if (!config.lookupMaybe(ORDER, PDFArray)) {
    config.set(ORDER, pdf.context.obj([]))
  }

  return { ocProperties, config, ocgs }
}

function setOcgVisibility(config: PDFDict, ref: PDFRef, visible: boolean): void {
  const baseOn = readBaseStateOn(config)
  let on = config.lookupMaybe(ON, PDFArray)
  let off = config.lookupMaybe(OFF, PDFArray)
  if (!on) {
    on = config.context.obj([]) as PDFArray
    config.set(ON, on)
  }
  if (!off) {
    off = config.context.obj([]) as PDFArray
    config.set(OFF, off)
  }

  removeRefFromArray(on, ref)
  removeRefFromArray(off, ref)

  if (baseOn) {
    if (!visible) {
      off.push(ref)
    }
  } else if (visible) {
    on.push(ref)
  } else {
    // BaseState OFF and hidden: leave out of ON (already removed).
  }
}

function appendToOrder(config: PDFDict, ref: PDFRef): void {
  let order = config.lookupMaybe(ORDER, PDFArray)
  if (!order) {
    order = config.context.obj([]) as PDFArray
    config.set(ORDER, order)
  }
  if (!arrayContainsRef(order, ref)) {
    order.push(ref)
  }
}

function findOcgRef(pdf: PDFDocument, layerId: string): PDFRef | null {
  if (layerId.startsWith('group:')) {
    return null
  }
  const objectNumber = Number(layerId)
  if (!Number.isFinite(objectNumber) || objectNumber <= 0) {
    return null
  }
  const ref = PDFRef.of(objectNumber)
  const dict = pdf.context.lookupMaybe(ref, PDFDict)
  if (!dict || !isOcgDict(dict)) {
    return null
  }
  // Prefer matching against registered OCGs list when present.
  const ocProperties = pdf.catalog.lookupMaybe(OC_PROPERTIES, PDFDict)
  const ocgs = ocProperties?.lookupMaybe(OCGS, PDFArray)
  if (ocgs && !arrayContainsRef(ocgs, ref)) {
    // Still allow if it looks like an OCG (some files list incompletely).
  }
  return ref
}

function removeRefFromArray(array: PDFArray, ref: PDFRef): void {
  for (let i = array.size() - 1; i >= 0; i -= 1) {
    const item = array.get(i)
    if (item instanceof PDFRef && sameRef(item, ref)) {
      array.remove(i)
    }
  }
}

function removeRefFromOrder(order: PDFArray, ref: PDFRef): void {
  for (let i = order.size() - 1; i >= 0; i -= 1) {
    const item = order.get(i)
    if (item instanceof PDFRef && sameRef(item, ref)) {
      order.remove(i)
      continue
    }
    if (item instanceof PDFArray) {
      removeRefFromOrder(item, ref)
      if (item.size() === 0) {
        order.remove(i)
      }
    }
  }
}

function arrayContainsRef(array: PDFArray, ref: PDFRef): boolean {
  for (let i = 0; i < array.size(); i += 1) {
    const item = array.get(i)
    if (item instanceof PDFRef && sameRef(item, ref)) {
      return true
    }
    if (item instanceof PDFArray && arrayContainsRef(item, ref)) {
      return true
    }
  }
  return false
}

function sameRef(a: PDFRef, b: PDFRef): boolean {
  return a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber
}

function refId(ref: PDFRef): string {
  return String(ref.objectNumber)
}

function readName(dict: PDFDict): string {
  const value = dict.get(NAME)
  if (!value) {
    return ''
  }
  const resolved = dict.context.lookup(value)
  return decodePdfText(resolved)
}

function isNameLike(value: PDFObject | undefined): boolean {
  return (
    value instanceof PDFString ||
    value instanceof PDFHexString ||
    value instanceof PDFName
  )
}

function decodePdfText(value: PDFObject | undefined): string {
  if (!value) {
    return ''
  }
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try {
      return value.decodeText()
    } catch {
      return value.asString()
    }
  }
  if (value instanceof PDFName) {
    return value.decodeText()
  }
  return ''
}
