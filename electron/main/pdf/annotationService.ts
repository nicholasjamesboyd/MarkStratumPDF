import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFObject,
} from 'pdf-lib'
import type {
  FormFieldBounds,
  HatchPattern,
  MarkupCreateRequest,
  MarkupInfo,
  MarkupPoint,
  MarkupStyle,
  MarkupTool,
} from '../../../shared/ipc'

const ANNOTS = PDFName.of('Annots')
const SUBTYPE = PDFName.of('Subtype')
const RECT = PDFName.of('Rect')
const TITLE = PDFName.of('T')
const SUBJECT = PDFName.of('Subj')
const CONTENTS = PDFName.of('Contents')
const CREATION_DATE = PDFName.of('CreationDate')
const MOD_DATE = PDFName.of('M')
const COLOR = PDFName.of('C')
const BS = PDFName.of('BS')
const BORDER = PDFName.of('Border')
const BE = PDFName.of('BE')
const L = PDFName.of('L')
const LE = PDFName.of('LE')
const VERTICES = PDFName.of('Vertices')
const INK_LIST = PDFName.of('InkList')
const QUAD_POINTS = PDFName.of('QuadPoints')
const CL = PDFName.of('CL')
const IT = PDFName.of('IT')
const DA = PDFName.of('DA')
const TOOL_KEY = PDFName.of('MarkStratumTool')
const HATCH_KEY = PDFName.of('MarkStratumHatch')

const TOOL_LABELS: Record<MarkupTool, string> = {
  line: 'Line',
  rectangle: 'Rectangle',
  arc: 'Arc',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  polyline: 'Polyline',
  polygon: 'Polygon',
  cloud: 'Cloud',
  cloudCallout: 'Cloud Callout',
  callout: 'Callout',
  textBox: 'Text Box',
  pen: 'Pen',
  highlighter: 'Highlighter',
}

const CLOSED_HATCH_TOOLS: ReadonlySet<MarkupTool> = new Set([
  'rectangle',
  'ellipse',
  'polygon',
  'cloud',
  'callout',
  'cloudCallout',
  'textBox',
])

export async function listAnnotationsFromBytes(bytes: Uint8Array): Promise<MarkupInfo[]> {
  const pdf = await loadPdf(bytes)
  return listAnnotations(pdf)
}

export async function createAnnotationInBytes(
  bytes: Uint8Array,
  request: MarkupCreateRequest,
): Promise<{ bytes: Uint8Array; markupId: string }> {
  const pdf = await loadPdf(bytes)
  const pageCount = pdf.getPageCount()
  if (request.pageIndex < 0 || request.pageIndex >= pageCount) {
    throw new Error(`Page index out of range: ${request.pageIndex}`)
  }
  if (!request.points.length) {
    throw new Error('Markup requires at least one point.')
  }

  const page = pdf.getPage(request.pageIndex)
  const author = request.author.trim() || 'Unknown'
  const style = normalizeStyle(request.style)
  const hatch = CLOSED_HATCH_TOOLS.has(request.tool) ? style.hatch : 'none'
  const now = pdfDateNow()

  const annotDict = buildAnnotDict(pdf, request.tool, request.points, {
    ...style,
    hatch,
  }, author, now)
  const annotRef = pdf.context.register(annotDict)

  const annots = ensureAnnots(page.node)
  annots.push(annotRef)

  const saved = await pdf.save({ useObjectStreams: false })
  return { bytes: saved, markupId: refId(annotRef) }
}

export async function deleteAnnotationInBytes(
  bytes: Uint8Array,
  markupId: string,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const target = Number(markupId)
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error(`Markup not found: ${markupId}`)
  }

  let removed = false
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(ANNOTS, PDFArray)
    if (!annots) {
      continue
    }
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      const entry = annots.get(i)
      if (entry instanceof PDFRef && entry.objectNumber === target) {
        annots.remove(i)
        removed = true
      }
    }
    if (annots.size() === 0) {
      page.node.delete(ANNOTS)
    }
  }

  if (!removed) {
    throw new Error(`Markup not found: ${markupId}`)
  }
  return pdf.save({ useObjectStreams: false })
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    if (pdf.isEncrypted) {
      throw new Error('Cannot edit markups in an encrypted PDF yet.')
    }
    return pdf
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/encrypt|password|security/i.test(message)) {
      throw new Error('Cannot edit markups in an encrypted PDF yet.')
    }
    if (message.startsWith('Cannot edit markups')) {
      throw error
    }
    throw new Error(`Could not open PDF for markups: ${message}`)
  }
}

function listAnnotations(pdf: PDFDocument): MarkupInfo[] {
  const markups: MarkupInfo[] = []
  const pages = pdf.getPages()
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!
    const annots = page.node.lookupMaybe(ANNOTS, PDFArray)
    if (!annots) {
      continue
    }
    for (let i = 0; i < annots.size(); i += 1) {
      const entry = annots.get(i)
      if (!(entry instanceof PDFRef)) {
        continue
      }
      const dict = pdf.context.lookupMaybe(entry, PDFDict)
      if (!dict) {
        continue
      }
      const parsed = parseAnnot(dict, entry, pageIndex)
      if (parsed) {
        markups.push(parsed)
      }
    }
  }
  return markups
}

function parseAnnot(dict: PDFDict, ref: PDFRef, pageIndex: number): MarkupInfo | null {
  const tool = readTool(dict)
  if (!tool) {
    return null
  }
  const bounds = readRect(dict)
  if (!bounds) {
    return null
  }
  const author = decodePdfText(dict.lookup(TITLE)) || 'Unknown'
  const contents = decodePdfText(dict.lookup(CONTENTS)) || undefined
  const createdAt = decodePdfText(dict.lookup(CREATION_DATE)) || undefined
  const hatch = readHatch(dict)
  const color = readColor(dict)
  const strokeWidth = readStrokeWidth(dict)
  const points = readPoints(dict, tool, bounds)
  return {
    id: refId(ref),
    pageIndex,
    tool,
    author,
    createdAt,
    contents,
    bounds,
    hatch,
    color,
    strokeWidth,
    points,
  }
}

function readTool(dict: PDFDict): MarkupTool | null {
  const custom = dict.get(TOOL_KEY)
  if (custom instanceof PDFName) {
    const name = custom.decodeText() as MarkupTool
    if (isMarkupTool(name)) {
      return name
    }
  }
  const subject = decodePdfText(dict.lookup(SUBJECT)).toLowerCase()
  if (subject.includes('cloud callout')) {
    return 'cloudCallout'
  }
  if (subject.includes('callout')) {
    return 'callout'
  }
  if (subject.includes('cloud')) {
    return 'cloud'
  }
  if (subject.includes('arrow')) {
    return 'arrow'
  }
  if (subject.includes('arc')) {
    return 'arc'
  }
  if (subject.includes('text')) {
    return 'textBox'
  }
  if (subject.includes('pen')) {
    return 'pen'
  }
  if (subject.includes('highlight')) {
    return 'highlighter'
  }

  const subtype = dict.lookup(SUBTYPE)
  if (!(subtype instanceof PDFName)) {
    return null
  }
  const kind = subtype.decodeText()
  switch (kind) {
    case 'Line':
      return hasArrowEnding(dict) ? 'arrow' : 'line'
    case 'Square':
      return 'rectangle'
    case 'Circle':
      return 'ellipse'
    case 'PolyLine':
      return 'polyline'
    case 'Polygon':
      return hasCloudyBorder(dict) ? 'cloud' : 'polygon'
    case 'Ink':
      return 'pen'
    case 'Highlight':
      return 'highlighter'
    case 'FreeText': {
      const intent = dict.lookup(IT)
      if (intent instanceof PDFName && intent.decodeText() === 'FreeTextCallout') {
        return hasCloudyBorder(dict) ? 'cloudCallout' : 'callout'
      }
      return 'textBox'
    }
    default:
      return null
  }
}

function buildAnnotDict(
  pdf: PDFDocument,
  tool: MarkupTool,
  points: MarkupPoint[],
  style: MarkupStyle,
  author: string,
  date: string,
): PDFDict {
  const bounds = boundsFromPoints(points, style.strokeWidth)
  const colorArr = pdf.context.obj([...style.color])
  const fields: Record<string, PDFObject | string | number | boolean | PDFObject[]> = {
    Type: 'Annot',
    Rect: pdf.context.obj([bounds.left, bounds.bottom, bounds.right, bounds.top]),
    C: colorArr,
    CA: style.opacity ?? 1,
    T: PDFString.of(author),
    Subj: PDFString.of(TOOL_LABELS[tool]),
    CreationDate: PDFString.of(date),
    M: PDFString.of(date),
    F: 4,
    MarkStratumTool: PDFName.of(tool),
    MarkStratumHatch: PDFName.of(style.hatch),
    BS: pdf.context.obj({ W: style.strokeWidth, S: 'S' }),
  }

  if (style.contents) {
    fields.Contents = PDFString.of(style.contents)
  }

  switch (tool) {
    case 'line':
      fields.Subtype = 'Line'
      fields.L = lineArray(pdf, points)
      break
    case 'arrow':
      fields.Subtype = 'Line'
      fields.L = lineArray(pdf, points)
      fields.LE = pdf.context.obj([PDFName.of('None'), PDFName.of('ClosedArrow')])
      break
    case 'rectangle':
      fields.Subtype = 'Square'
      break
    case 'ellipse':
      fields.Subtype = 'Circle'
      break
    case 'polyline':
      fields.Subtype = 'PolyLine'
      fields.Vertices = verticesArray(pdf, points)
      break
    case 'polygon':
      fields.Subtype = 'Polygon'
      fields.Vertices = verticesArray(pdf, points)
      break
    case 'cloud':
      fields.Subtype = 'Polygon'
      fields.Vertices = verticesArray(pdf, ensureClosed(points))
      fields.BE = pdf.context.obj({ S: 'C', I: 2 })
      break
    case 'arc':
      fields.Subtype = 'Ink'
      fields.InkList = inkListArray(pdf, [sampleArc(points)])
      break
    case 'pen':
      fields.Subtype = 'Ink'
      fields.InkList = inkListArray(pdf, [points])
      break
    case 'highlighter':
      fields.Subtype = 'Highlight'
      fields.QuadPoints = quadPointsFromStroke(pdf, points, style.strokeWidth)
      fields.CA = style.opacity ?? 0.4
      break
    case 'textBox':
      fields.Subtype = 'FreeText'
      fields.Contents = PDFString.of(style.contents ?? '')
      fields.DA = PDFString.of(defaultAppearance(style.color))
      break
    case 'callout':
      fields.Subtype = 'FreeText'
      fields.IT = PDFName.of('FreeTextCallout')
      fields.Contents = PDFString.of(style.contents ?? '')
      fields.DA = PDFString.of(defaultAppearance(style.color))
      fields.CL = calloutArray(pdf, points)
      break
    case 'cloudCallout':
      fields.Subtype = 'FreeText'
      fields.IT = PDFName.of('FreeTextCallout')
      fields.Contents = PDFString.of(style.contents ?? '')
      fields.DA = PDFString.of(defaultAppearance(style.color))
      fields.CL = calloutArray(pdf, points)
      fields.BE = pdf.context.obj({ S: 'C', I: 2 })
      break
    default:
      fields.Subtype = 'Square'
  }

  const apStream = buildAppearance(pdf, tool, points, style, bounds)
  if (apStream) {
    fields.AP = pdf.context.obj({ N: apStream })
  }

  return pdf.context.obj(fields) as PDFDict
}

function buildAppearance(
  pdf: PDFDocument,
  tool: MarkupTool,
  points: MarkupPoint[],
  style: MarkupStyle,
  bounds: FormFieldBounds,
): PDFRef | null {
  const width = Math.max(1, bounds.right - bounds.left)
  const height = Math.max(1, bounds.top - bounds.bottom)
  const ops = appearanceOperators(tool, points, style, bounds)
  if (!ops) {
    return null
  }
  const stream = pdf.context.flateStream(ops, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, width, height],
    Resources: pdf.context.obj({}),
  })
  return pdf.context.register(stream)
}

function appearanceOperators(
  tool: MarkupTool,
  points: MarkupPoint[],
  style: MarkupStyle,
  bounds: FormFieldBounds,
): string | null {
  const [r, g, b] = style.color
  const ox = bounds.left
  const oy = bounds.bottom
  const local = (p: MarkupPoint) => ({ x: p.x - ox, y: p.y - oy })
  const w = style.strokeWidth
  const stroke = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${w.toFixed(2)} w`
  const fill = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`

  const pathFrom = (pts: MarkupPoint[], close: boolean) => {
    if (pts.length === 0) {
      return ''
    }
    const first = local(pts[0]!)
    let out = `${fmt(first.x)} ${fmt(first.y)} m`
    for (let i = 1; i < pts.length; i += 1) {
      const p = local(pts[i]!)
      out += ` ${fmt(p.x)} ${fmt(p.y)} l`
    }
    if (close) {
      out += ' h'
    }
    return out
  }

  switch (tool) {
    case 'line':
    case 'arrow': {
      if (points.length < 2) {
        return null
      }
      const a = local(points[0]!)
      const c = local(points[points.length - 1]!)
      let body = `${stroke}\n${fmt(a.x)} ${fmt(a.y)} m ${fmt(c.x)} ${fmt(c.y)} l S`
      if (tool === 'arrow') {
        body += `\n${arrowHeadOps(a, c, w, r, g, b)}`
      }
      return body
    }
    case 'rectangle':
    case 'textBox':
    case 'callout':
    case 'cloudCallout': {
      const box = rectPath(bounds, ox, oy)
      return closedShapeAppearance(box, style, stroke, fill, false)
    }
    case 'ellipse': {
      const path = ellipsePath(bounds, ox, oy)
      return closedShapeAppearance(path, style, stroke, fill, false)
    }
    case 'polygon':
    case 'cloud': {
      const path = pathFrom(ensureClosed(points), true)
      return closedShapeAppearance(path, style, stroke, fill, tool === 'cloud')
    }
    case 'polyline': {
      return `${stroke}\n${pathFrom(points, false)} S`
    }
    case 'arc': {
      const arcPts = sampleArc(points)
      return `${stroke}\n${pathFrom(arcPts, false)} S`
    }
    case 'pen': {
      return `${stroke}\n${pathFrom(points, false)} S`
    }
    case 'highlighter': {
      const quads = strokeToQuads(points, style.strokeWidth)
      let out = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg\n`
      for (const q of quads) {
        const a = local(q[0]!)
        const bb = local(q[1]!)
        const c = local(q[2]!)
        const d = local(q[3]!)
        out += `${fmt(a.x)} ${fmt(a.y)} m ${fmt(bb.x)} ${fmt(bb.y)} l ${fmt(c.x)} ${fmt(c.y)} l ${fmt(d.x)} ${fmt(d.y)} l h f\n`
      }
      return out
    }
    default:
      return null
  }
}

function closedShapeAppearance(
  path: string,
  style: MarkupStyle,
  stroke: string,
  fill: string,
  cloudy: boolean,
): string {
  const hatch = style.hatch
  let out = ''
  if (hatch !== 'none') {
    out += 'q\n'
    out += `${path} W n\n`
    out += hatchOps(style, path)
    out += 'Q\n'
  }
  out += `${stroke}\n`
  if (cloudy) {
    // Border effect is on the annot; still stroke the polygon path.
    out += `${path} S\n`
  } else if (hatch === 'none') {
    out += `${path} S\n`
  } else {
    out += `${path} S\n`
  }
  void fill
  return out
}

function hatchOps(style: MarkupStyle, _clipPath: string): string {
  const [r, g, b] = style.color
  const spacing = Math.max(6, style.strokeWidth * 4)
  // Use a generous bounding box from typical page units relative to form BBox.
  // Operators are clipped by W n above; draw a dense band of lines.
  let out = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG 0.75 w\n`
  const extent = 2000
  if (style.hatch === 'diagonal' || style.hatch === 'crosshatch') {
    for (let i = -extent; i <= extent; i += spacing) {
      out += `${fmt(i)} ${fmt(-extent)} m ${fmt(i + extent)} ${fmt(extent)} l S\n`
    }
  }
  if (style.hatch === 'crosshatch') {
    for (let i = -extent; i <= extent; i += spacing) {
      out += `${fmt(i)} ${fmt(extent)} m ${fmt(i + extent)} ${fmt(-extent)} l S\n`
    }
  }
  return out
}

function rectPath(bounds: FormFieldBounds, ox: number, oy: number): string {
  const x = bounds.left - ox
  const y = bounds.bottom - oy
  const w = bounds.right - bounds.left
  const h = bounds.top - bounds.bottom
  return `${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`
}

function ellipsePath(bounds: FormFieldBounds, ox: number, oy: number): string {
  const cx = (bounds.left + bounds.right) / 2 - ox
  const cy = (bounds.bottom + bounds.top) / 2 - oy
  const rx = (bounds.right - bounds.left) / 2
  const ry = (bounds.top - bounds.bottom) / 2
  const k = 0.5522847498307936
  const oxOff = rx * k
  const oyOff = ry * k
  return [
    `${fmt(cx - rx)} ${fmt(cy)} m`,
    `${fmt(cx - rx)} ${fmt(cy + oyOff)} ${fmt(cx - oxOff)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)} c`,
    `${fmt(cx + oxOff)} ${fmt(cy + ry)} ${fmt(cx + rx)} ${fmt(cy + oyOff)} ${fmt(cx + rx)} ${fmt(cy)} c`,
    `${fmt(cx + rx)} ${fmt(cy - oyOff)} ${fmt(cx + oxOff)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)} c`,
    `${fmt(cx - oxOff)} ${fmt(cy - ry)} ${fmt(cx - rx)} ${fmt(cy - oyOff)} ${fmt(cx - rx)} ${fmt(cy)} c`,
    'h',
  ].join(' ')
}

function arrowHeadOps(
  from: MarkupPoint,
  to: MarkupPoint,
  strokeWidth: number,
  r: number,
  g: number,
  b: number,
): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const size = Math.max(8, strokeWidth * 4)
  const left = { x: to.x - ux * size - uy * size * 0.5, y: to.y - uy * size + ux * size * 0.5 }
  const right = { x: to.x - ux * size + uy * size * 0.5, y: to.y - uy * size - ux * size * 0.5 }
  return [
    `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`,
    `${fmt(to.x)} ${fmt(to.y)} m ${fmt(left.x)} ${fmt(left.y)} l ${fmt(right.x)} ${fmt(right.y)} l h f`,
  ].join('\n')
}

function sampleArc(points: MarkupPoint[]): MarkupPoint[] {
  if (points.length < 2) {
    return points
  }
  const start = points[0]!
  const end = points[1]!
  const mid = points[2] ?? {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2 + Math.hypot(end.x - start.x, end.y - start.y) * 0.25,
  }
  const circle = circleFrom3Points(start, mid, end)
  if (!circle) {
    return [start, mid, end]
  }
  const a0 = Math.atan2(start.y - circle.cy, start.x - circle.cx)
  const a1 = Math.atan2(mid.y - circle.cy, mid.x - circle.cx)
  const a2 = Math.atan2(end.y - circle.cy, end.x - circle.cx)
  const ccw = deltaAngle(a0, a1) > 0
  let sweep = deltaAngle(a0, a2)
  if (ccw && sweep < 0) {
    sweep += Math.PI * 2
  }
  if (!ccw && sweep > 0) {
    sweep -= Math.PI * 2
  }
  const steps = Math.max(12, Math.ceil(Math.abs(sweep) / (Math.PI / 24)))
  const out: MarkupPoint[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const a = a0 + sweep * t
    out.push({
      x: circle.cx + Math.cos(a) * circle.r,
      y: circle.cy + Math.sin(a) * circle.r,
    })
  }
  return out
}

function circleFrom3Points(
  a: MarkupPoint,
  b: MarkupPoint,
  c: MarkupPoint,
): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-6) {
    return null
  }
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  const r = Math.hypot(a.x - cx, a.y - cy)
  return { cx, cy, r }
}

function deltaAngle(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) {
    d -= Math.PI * 2
  }
  while (d < -Math.PI) {
    d += Math.PI * 2
  }
  return d
}

function strokeToQuads(points: MarkupPoint[], strokeWidth: number): MarkupPoint[][] {
  if (points.length < 2) {
    const p = points[0] ?? { x: 0, y: 0 }
    const h = Math.max(4, strokeWidth)
    return [[
      { x: p.x - h, y: p.y - h },
      { x: p.x + h, y: p.y - h },
      { x: p.x + h, y: p.y + h },
      { x: p.x - h, y: p.y + h },
    ]]
  }
  const quads: MarkupPoint[][] = []
  const half = Math.max(2, strokeWidth / 2)
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * half
    const ny = (dx / len) * half
    quads.push([
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ])
  }
  return quads
}

function boundsFromPoints(points: MarkupPoint[], strokeWidth: number): FormFieldBounds {
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const p of points) {
    left = Math.min(left, p.x)
    right = Math.max(right, p.x)
    bottom = Math.min(bottom, p.y)
    top = Math.max(top, p.y)
  }
  if (!Number.isFinite(left)) {
    left = 0
    right = 0
    bottom = 0
    top = 0
  }
  const pad = Math.max(2, strokeWidth)
  return {
    left: left - pad,
    bottom: bottom - pad,
    right: right + pad,
    top: top + pad,
  }
}

function ensureAnnots(pageNode: PDFDict): PDFArray {
  const existing = pageNode.lookupMaybe(ANNOTS, PDFArray)
  if (existing) {
    return existing
  }
  const created = pageNode.context.obj([]) as PDFArray
  pageNode.set(ANNOTS, created)
  return created
}

function lineArray(pdf: PDFDocument, points: MarkupPoint[]): PDFArray {
  const a = points[0]!
  const b = points[points.length - 1]!
  return pdf.context.obj([a.x, a.y, b.x, b.y]) as PDFArray
}

function verticesArray(pdf: PDFDocument, points: MarkupPoint[]): PDFArray {
  const flat: number[] = []
  for (const p of points) {
    flat.push(p.x, p.y)
  }
  return pdf.context.obj(flat) as PDFArray
}

function inkListArray(pdf: PDFDocument, strokes: MarkupPoint[][]): PDFArray {
  const strokesArr = pdf.context.obj([]) as PDFArray
  for (const stroke of strokes) {
    const flat: number[] = []
    for (const p of stroke) {
      flat.push(p.x, p.y)
    }
    strokesArr.push(pdf.context.obj(flat))
  }
  return strokesArr
}

function quadPointsFromStroke(pdf: PDFDocument, points: MarkupPoint[], strokeWidth: number): PDFArray {
  const quads = strokeToQuads(points, strokeWidth)
  const flat: number[] = []
  for (const q of quads) {
    // PDF QuadPoints order: ul, ur, ll, lr per quad
    flat.push(q[0]!.x, q[0]!.y, q[1]!.x, q[1]!.y, q[3]!.x, q[3]!.y, q[2]!.x, q[2]!.y)
  }
  return pdf.context.obj(flat) as PDFArray
}

function calloutArray(pdf: PDFDocument, points: MarkupPoint[]): PDFArray {
  // points: [boxA, boxB, ...leader ending at tip]. CL is start (near box), knee?, tip.
  if (points.length < 3) {
    const box = boundsFromPoints(points.slice(0, 2), 1)
    const tip = points[points.length - 1] ?? { x: box.right + 20, y: box.top + 20 }
    return pdf.context.obj([
      (box.left + box.right) / 2,
      box.bottom,
      tip.x,
      tip.y,
    ]) as PDFArray
  }
  const box = boundsFromPoints(points.slice(0, 2), 1)
  const leader = points.slice(2)
  const start = { x: (box.left + box.right) / 2, y: box.bottom }
  const flat: number[] = [start.x, start.y]
  for (const p of leader) {
    flat.push(p.x, p.y)
  }
  return pdf.context.obj(flat) as PDFArray
}

function ensureClosed(points: MarkupPoint[]): MarkupPoint[] {
  if (points.length < 2) {
    return points
  }
  const first = points[0]!
  const last = points[points.length - 1]!
  if (Math.hypot(first.x - last.x, first.y - last.y) < 0.01) {
    return points
  }
  return [...points, first]
}

function normalizeStyle(style: MarkupStyle): MarkupStyle {
  const color = style.color.map((c) => clamp01(c)) as [number, number, number]
  return {
    color,
    strokeWidth: Math.max(0.5, style.strokeWidth || 1.5),
    hatch: style.hatch ?? 'none',
    opacity: style.opacity,
    contents: style.contents,
  }
}

function defaultAppearance(color: [number, number, number]): string {
  const [r, g, b] = color
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg /Helv 12 Tf`
}

function readRect(dict: PDFDict): FormFieldBounds | null {
  const rect = dict.lookup(RECT)
  if (!(rect instanceof PDFArray) || rect.size() < 4) {
    return null
  }
  const nums = [0, 1, 2, 3].map((i) => asNumber(rect.get(i)))
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

function readColor(dict: PDFDict): [number, number, number] {
  const color = dict.lookup(COLOR)
  if (color instanceof PDFArray && color.size() >= 3) {
    return [
      asNumber(color.get(0)) ?? 1,
      asNumber(color.get(1)) ?? 0,
      asNumber(color.get(2)) ?? 0,
    ]
  }
  return [1, 0, 0]
}

function readStrokeWidth(dict: PDFDict): number {
  const bs = dict.lookupMaybe(BS, PDFDict)
  if (bs) {
    const w = asNumber(bs.lookup(PDFName.of('W')))
    if (w !== null) {
      return w
    }
  }
  const border = dict.lookup(BORDER)
  if (border instanceof PDFArray && border.size() >= 3) {
    return asNumber(border.get(2)) ?? 1.5
  }
  return 1.5
}

function readHatch(dict: PDFDict): HatchPattern {
  const value = dict.get(HATCH_KEY)
  if (value instanceof PDFName) {
    const name = value.decodeText()
    if (name === 'diagonal' || name === 'crosshatch' || name === 'none') {
      return name
    }
  }
  return 'none'
}

function readPoints(dict: PDFDict, tool: MarkupTool, bounds: FormFieldBounds): MarkupPoint[] {
  if (tool === 'line' || tool === 'arrow') {
    const line = dict.lookup(L)
    if (line instanceof PDFArray && line.size() >= 4) {
      return [
        { x: asNumber(line.get(0)) ?? 0, y: asNumber(line.get(1)) ?? 0 },
        { x: asNumber(line.get(2)) ?? 0, y: asNumber(line.get(3)) ?? 0 },
      ]
    }
  }
  if (tool === 'polyline' || tool === 'polygon' || tool === 'cloud') {
    const vertices = dict.lookup(VERTICES)
    if (vertices instanceof PDFArray) {
      return pairsFromArray(vertices)
    }
  }
  if (tool === 'pen' || tool === 'arc') {
    const ink = dict.lookup(INK_LIST)
    if (ink instanceof PDFArray && ink.size() > 0) {
      const first = ink.lookup(0)
      if (first instanceof PDFArray) {
        return pairsFromArray(first)
      }
    }
  }
  if (tool === 'highlighter') {
    const quads = dict.lookup(QUAD_POINTS)
    if (quads instanceof PDFArray && quads.size() >= 8) {
      return [
        { x: asNumber(quads.get(0)) ?? 0, y: asNumber(quads.get(1)) ?? 0 },
        { x: asNumber(quads.get(2)) ?? 0, y: asNumber(quads.get(3)) ?? 0 },
      ]
    }
  }
  if (tool === 'callout' || tool === 'cloudCallout') {
    const cl = dict.lookup(CL)
    const leader = cl instanceof PDFArray ? pairsFromArray(cl) : []
    return [
      { x: bounds.left, y: bounds.bottom },
      { x: bounds.right, y: bounds.top },
      ...leader,
    ]
  }
  return [
    { x: bounds.left, y: bounds.bottom },
    { x: bounds.right, y: bounds.top },
  ]
}

function pairsFromArray(arr: PDFArray): MarkupPoint[] {
  const points: MarkupPoint[] = []
  for (let i = 0; i + 1 < arr.size(); i += 2) {
    points.push({
      x: asNumber(arr.get(i)) ?? 0,
      y: asNumber(arr.get(i + 1)) ?? 0,
    })
  }
  return points
}

function hasArrowEnding(dict: PDFDict): boolean {
  const le = dict.lookup(LE)
  if (!(le instanceof PDFArray)) {
    return false
  }
  for (let i = 0; i < le.size(); i += 1) {
    const item = le.get(i)
    if (item instanceof PDFName && /arrow/i.test(item.decodeText())) {
      return true
    }
  }
  return false
}

function hasCloudyBorder(dict: PDFDict): boolean {
  const be = dict.lookupMaybe(BE, PDFDict)
  if (!be) {
    return false
  }
  const s = be.lookup(PDFName.of('S'))
  return s instanceof PDFName && s.decodeText() === 'C'
}

function isMarkupTool(value: string): value is MarkupTool {
  return value in TOOL_LABELS
}

function asNumber(value: PDFObject | undefined): number | null {
  if (value instanceof PDFNumber) {
    return value.asNumber()
  }
  return null
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

function pdfDateNow(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function refId(ref: PDFRef): string {
  return String(ref.objectNumber)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 0
  }
  return Math.min(1, Math.max(0, n))
}

function fmt(n: number): string {
  return n.toFixed(2)
}
