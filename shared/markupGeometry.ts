import type { MarkupPoint } from './ipc'

export const DEFAULT_CLOUD_ARC_RADIUS = 8

/** Clearance between a callout cursor and the text box trailing it, in page points. */
export const CALLOUT_BOX_GAP = 12

/** Centre of a box given two opposite corners. */
export function boxCentre(a: MarkupPoint, b: MarkupPoint): MarkupPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Anchor on a text box edge facing `toward`: the centre of the nearest side picked
 * by the dominant axis, so leaders meet the box's side, top, or bottom.
 */
export function boxSideAnchor(a: MarkupPoint, b: MarkupPoint, toward: MarkupPoint): MarkupPoint {
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const bottom = Math.min(a.y, b.y)
  const top = Math.max(a.y, b.y)
  const cx = (left + right) / 2
  const cy = (bottom + top) / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: dx >= 0 ? right : left, y: cy }
  }
  return { x: cx, y: dy >= 0 ? top : bottom }
}

/**
 * Default callout text box for a click at `point`: held clear of the cursor on the
 * side away from the tip, so the leader runs from the box past the cursor to the tip.
 */
export function calloutBoxCorners(
  point: MarkupPoint,
  tip: MarkupPoint,
  width: number,
  height: number,
): [MarkupPoint, MarkupPoint] {
  const dx = tip.x - point.x
  const dy = tip.y - point.y
  if (Math.abs(dx) > Math.abs(dy)) {
    const cx = dx > 0 ? point.x - CALLOUT_BOX_GAP - width / 2 : point.x + CALLOUT_BOX_GAP + width / 2
    return [
      { x: cx - width / 2, y: point.y - height / 2 },
      { x: cx + width / 2, y: point.y + height / 2 },
    ]
  }
  const cy = dy >= 0 ? point.y - CALLOUT_BOX_GAP - height / 2 : point.y + CALLOUT_BOX_GAP + height / 2
  return [
    { x: point.x - width / 2, y: cy - height / 2 },
    { x: point.x + width / 2, y: cy + height / 2 },
  ]
}

/** Circular arc through start, optional mid bulge point, and end. */
export function sampleArc(points: MarkupPoint[]): MarkupPoint[] {
  if (points.length < 2) {
    return points
  }
  const start = points[0]!
  const end = points[1]!
  const mid =
    points[2] ??
    arcMidFromChord(start, end, Math.hypot(end.x - start.x, end.y - start.y) * 0.25)
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
  const steps = Math.max(24, Math.ceil(Math.abs(sweep) / (Math.PI / 36)))
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

/** Mid control point for a click-drag arc (chord + perpendicular bulge). */
export function arcMidFromChord(
  start: MarkupPoint,
  end: MarkupPoint,
  bulge: number,
): MarkupPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const mx = (start.x + end.x) / 2
  const my = (start.y + end.y) / 2
  const nx = -dy / len
  const ny = dx / len
  return { x: mx + nx * bulge, y: my + ny * bulge }
}

/**
 * Scalloped cloud outline: outward semicircle arcs along each edge.
 * Returns dense polyline points suitable for SVG or PDF path stroking.
 */
export function cloudPolylineFromPolygon(
  points: MarkupPoint[],
  arcRadius = DEFAULT_CLOUD_ARC_RADIUS,
): MarkupPoint[] {
  const closed = ensureClosed(points)
  if (closed.length < 3) {
    return closed
  }
  const verts = closed.slice(0, -1)
  if (verts.length < 2) {
    return closed
  }
  const signed = polygonSignedArea(verts)
  const outwardSign = signed >= 0 ? 1 : -1
  const radius = Math.max(2, arcRadius)
  const out: MarkupPoint[] = []

  for (let i = 0; i < verts.length; i += 1) {
    const a = verts[i]!
    const b = verts[(i + 1) % verts.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const edgeLen = Math.hypot(dx, dy)
    if (edgeLen < 1e-4) {
      continue
    }
    const ux = dx / edgeLen
    const uy = dy / edgeLen
    const nx = -uy * outwardSign
    const ny = ux * outwardSign
    const count = Math.max(1, Math.round(edgeLen / (radius * 1.6)))
    const step = edgeLen / count

    for (let s = 0; s < count; s += 1) {
      const x0 = a.x + ux * step * s
      const y0 = a.y + uy * step * s
      const x1 = a.x + ux * step * (s + 1)
      const y1 = a.y + uy * step * (s + 1)
      const mx = (x0 + x1) / 2
      const my = (y0 + y1) / 2
      const bulge = Math.min(radius, step * 0.55)
      const cx = mx + nx * bulge
      const cy = my + ny * bulge
      const startAngle = Math.atan2(y0 - cy, x0 - cx)
      const endAngle = Math.atan2(y1 - cy, x1 - cx)
      let sweep = deltaAngle(startAngle, endAngle)
      // Prefer the short outward bulge (less than PI).
      if (Math.abs(sweep) > Math.PI) {
        sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2
      }
      const segs = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 10)))
      for (let k = 0; k <= segs; k += 1) {
        if (s > 0 && k === 0) {
          continue
        }
        const t = k / segs
        const ang = startAngle + sweep * t
        const r = Math.hypot(x0 - cx, y0 - cy)
        out.push({
          x: cx + Math.cos(ang) * r,
          y: cy + Math.sin(ang) * r,
        })
      }
    }
  }

  if (out.length > 0) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
      out.push({ ...first })
    }
  }
  return out.length >= 2 ? out : closed
}

/** SVG path `d` for a cloud outline (screen-space points). */
export function cloudSvgPath(points: MarkupPoint[], arcRadius?: number): string {
  const poly = cloudPolylineFromPolygon(points, arcRadius)
  if (poly.length === 0) {
    return ''
  }
  let d = `M ${poly[0]!.x} ${poly[0]!.y}`
  for (let i = 1; i < poly.length; i += 1) {
    d += ` L ${poly[i]!.x} ${poly[i]!.y}`
  }
  d += ' Z'
  return d
}

export function ensureClosed(points: MarkupPoint[]): MarkupPoint[] {
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

function polygonSignedArea(verts: MarkupPoint[]): number {
  let area = 0
  for (let i = 0; i < verts.length; i += 1) {
    const a = verts[i]!
    const b = verts[(i + 1) % verts.length]!
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
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
