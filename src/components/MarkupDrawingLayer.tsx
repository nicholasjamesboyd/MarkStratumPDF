import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { MarkupPoint, MarkupTool } from '../../shared/ipc'
import { arcMidFromChord, boxCentre, boxSideAnchor, calloutBoxCorners, sampleArc } from '../../shared/markupGeometry'
import type { MarkupDrawStyle } from '../markup/markupState'

type MarkupDrawingLayerProps = {
  pageHeightPts: number
  scale: number
  tool: MarkupTool | null
  style: MarkupDrawStyle
  author: string
  onCreate: (input: {
    pageIndex: number
    tool: MarkupTool
    author: string
    style: MarkupDrawStyle
    points: MarkupPoint[]
    contents?: string
  }) => void
  pageIndex: number
}

type DraftState =
  | { mode: 'idle' }
  | { mode: 'drag'; start: MarkupPoint; current: MarkupPoint }
  | { mode: 'arcDrag'; start: MarkupPoint; current: MarkupPoint; bulge: number }
  | { mode: 'poly'; points: MarkupPoint[]; cursor: MarkupPoint | null }
  | { mode: 'freehand'; points: MarkupPoint[] }
  /** Regular callout: click the arrow tip first, then a click drops the text box. */
  | { mode: 'calloutTip'; tip: MarkupPoint; cursor: MarkupPoint }
  | { mode: 'calloutBox'; tip: MarkupPoint; start: MarkupPoint; current: MarkupPoint }
  /** Cloud callout: cloud subject box, then leader follows mouse to text box. */
  | { mode: 'cloudArea'; start: MarkupPoint; current: MarkupPoint }
  | {
      mode: 'cloudLeader'
      cloud: [MarkupPoint, MarkupPoint]
      cursor: MarkupPoint
    }
  | {
      mode: 'textEntry'
      tool: MarkupTool
      points: MarkupPoint[]
      text: string
      box: { x: number; y: number; width: number; height: number }
    }

const DRAG_TOOLS: ReadonlySet<MarkupTool> = new Set([
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'textBox',
])

const POLY_TOOLS: ReadonlySet<MarkupTool> = new Set(['polyline', 'polygon', 'cloud'])
const TEXT_TOOLS: ReadonlySet<MarkupTool> = new Set(['textBox', 'callout', 'cloudCallout'])
const CLOSE_SNAP_PX = 8
const MIN_DRAG_PTS = 2
const DEFAULT_CLOUD_SIZE = 48
const DEFAULT_TEXT_WIDTH = 100
const DEFAULT_TEXT_HEIGHT = 36

function normalizeBox(
  a: MarkupPoint,
  b: MarkupPoint,
  minSize = 8,
): [MarkupPoint, MarkupPoint] {
  let left = Math.min(a.x, b.x)
  let right = Math.max(a.x, b.x)
  let bottom = Math.min(a.y, b.y)
  let top = Math.max(a.y, b.y)
  if (right - left < minSize) {
    const cx = (left + right) / 2
    left = cx - minSize / 2
    right = cx + minSize / 2
  }
  if (top - bottom < minSize) {
    const cy = (bottom + top) / 2
    bottom = cy - minSize / 2
    top = cy + minSize / 2
  }
  return [
    { x: left, y: bottom },
    { x: right, y: top },
  ]
}

function boxAroundPoint(center: MarkupPoint, width: number, height: number): [MarkupPoint, MarkupPoint] {
  return [
    { x: center.x - width / 2, y: center.y - height / 2 },
    { x: center.x + width / 2, y: center.y + height / 2 },
  ]
}

/** Callout box for the second click: the pulled box, or the default box when nothing was dragged. */
function calloutBoxFromDrag(
  start: MarkupPoint,
  current: MarkupPoint,
  tip: MarkupPoint,
): [MarkupPoint, MarkupPoint] {
  if (Math.hypot(current.x - start.x, current.y - start.y) < MIN_DRAG_PTS) {
    return calloutBoxCorners(start, tip, DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT)
  }
  return normalizeBox(start, current)
}

/** Cloud callout text box for a click at `point`, trailing the cursor away from the cloud. */
function cloudCalloutTextBox(
  point: MarkupPoint,
  cloud: [MarkupPoint, MarkupPoint],
): [MarkupPoint, MarkupPoint] {
  return calloutBoxCorners(point, boxCentre(cloud[0], cloud[1]), DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT)
}

export function MarkupDrawingLayer({
  pageHeightPts,
  scale,
  tool,
  style,
  author,
  onCreate,
  pageIndex,
}: MarkupDrawingLayerProps) {
  const [draft, setDraft] = useState<DraftState>({ mode: 'idle' })
  const draftRef = useRef(draft)
  draftRef.current = draft
  const onCreateRef = useRef(onCreate)
  onCreateRef.current = onCreate
  const textEntryCancelledRef = useRef(false)

  const cancelDraft = () => {
    if (draftRef.current.mode === 'textEntry') {
      // Chromium fires blur when a focused element is removed, so flag the
      // cancel before the textarea unmounts to keep onBlur from committing.
      textEntryCancelledRef.current = true
    }
    setDraft({ mode: 'idle' })
  }

  useEffect(() => {
    setDraft({ mode: 'idle' })
  }, [tool, pageIndex])

  useEffect(() => {
    if (!tool) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelDraft()
        return
      }
      const current = draftRef.current
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        current.mode === 'poly' &&
        current.points.length >= 2 &&
        POLY_TOOLS.has(tool)
      ) {
        event.preventDefault()
        finishPoly(tool, current.points)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tool])

  if (!tool) {
    return null
  }

  const toPagePoint = (clientX: number, clientY: number, target: HTMLElement): MarkupPoint => {
    const rect = target.getBoundingClientRect()
    const x = (clientX - rect.left) / scale
    const yFromTop = (clientY - rect.top) / scale
    return { x, y: pageHeightPts - yFromTop }
  }

  const toScreen = (point: MarkupPoint) => ({
    x: point.x * scale,
    y: (pageHeightPts - point.y) * scale,
  })

  const commit = (request: {
    tool: MarkupTool
    points: MarkupPoint[]
    contents?: string
  }) => {
    onCreateRef.current({
      pageIndex,
      tool: request.tool,
      author,
      style,
      points: request.points,
      contents: request.contents,
    })
    setDraft({ mode: 'idle' })
  }

  const beginTextEntry = (nextTool: MarkupTool, points: MarkupPoint[]) => {
    textEntryCancelledRef.current = false
    const textPts =
      nextTool === 'cloudCallout' && points.length >= 4
        ? [points[2]!, points[3]!]
        : [points[0]!, points[1]!]
    const a = toScreen(textPts[0]!)
    const b = toScreen(textPts[1]!)
    setDraft({
      mode: 'textEntry',
      tool: nextTool,
      points,
      text: '',
      box: {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(40, Math.abs(b.x - a.x)),
        height: Math.max(24, Math.abs(b.y - a.y)),
      },
    })
  }

  const finishPoly = (polyTool: MarkupTool, points: MarkupPoint[]) => {
    commit({ tool: polyTool, points })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !tool) {
      return
    }
    const current = draftRef.current
    if (current.mode === 'textEntry') {
      return
    }
    event.stopPropagation()
    event.preventDefault()
    const point = toPagePoint(event.clientX, event.clientY, event.currentTarget)
    event.currentTarget.setPointerCapture(event.pointerId)

    if (DRAG_TOOLS.has(tool)) {
      setDraft({ mode: 'drag', start: point, current: point })
      return
    }
    if (tool === 'arc') {
      setDraft({ mode: 'arcDrag', start: point, current: point, bulge: 0 })
      return
    }
    if (POLY_TOOLS.has(tool)) {
      if (current.mode === 'poly') {
        const first = current.points[0]
        if (
          first &&
          (tool === 'polygon' || tool === 'cloud') &&
          current.points.length >= 2 &&
          Math.hypot(point.x - first.x, point.y - first.y) * scale <= CLOSE_SNAP_PX
        ) {
          finishPoly(tool, current.points)
          return
        }
        setDraft({
          mode: 'poly',
          points: [...current.points, point],
          cursor: point,
        })
        return
      }
      setDraft({ mode: 'poly', points: [point], cursor: point })
      return
    }
    if (tool === 'pen' || tool === 'highlighter') {
      setDraft({ mode: 'freehand', points: [point] })
      return
    }
    if (tool === 'callout') {
      if (current.mode === 'calloutTip') {
        setDraft({
          mode: 'calloutBox',
          tip: current.tip,
          start: point,
          current: point,
        })
        return
      }
      setDraft({ mode: 'calloutTip', tip: point, cursor: point })
      return
    }
    if (tool === 'cloudCallout') {
      if (current.mode === 'cloudLeader') {
        const textBox = cloudCalloutTextBox(point, current.cloud)
        beginTextEntry(tool, [current.cloud[0], current.cloud[1], textBox[0], textBox[1]])
        return
      }
      setDraft({ mode: 'cloudArea', start: point, current: point })
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = toPagePoint(event.clientX, event.clientY, event.currentTarget)
    setDraft((prev) => {
      if (prev.mode === 'drag' || prev.mode === 'calloutBox' || prev.mode === 'cloudArea') {
        return { ...prev, current: point }
      }
      if (prev.mode === 'calloutTip') {
        return { ...prev, cursor: point }
      }
      if (prev.mode === 'cloudLeader') {
        return { ...prev, cursor: point }
      }
      if (prev.mode === 'arcDrag') {
        const chord = Math.hypot(point.x - prev.start.x, point.y - prev.start.y)
        const bulge = Math.max(chord * 0.25, 1) * (point.y >= prev.start.y ? 1 : -1)
        return { mode: 'arcDrag', start: prev.start, current: point, bulge }
      }
      if (prev.mode === 'poly') {
        return { ...prev, cursor: point }
      }
      if (prev.mode === 'freehand') {
        const last = prev.points[prev.points.length - 1]
        if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.5) {
          return prev
        }
        return { mode: 'freehand', points: [...prev.points, point] }
      }
      return prev
    })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = draftRef.current
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }

    if (current.mode === 'drag' && tool && DRAG_TOOLS.has(tool)) {
      const dist = Math.hypot(
        current.current.x - current.start.x,
        current.current.y - current.start.y,
      )
      if (dist < 2) {
        setDraft({ mode: 'idle' })
        return
      }
      // Arrow: first point is tip; store [tail, tip] for tip-at-end PDF mapping.
      const points =
        tool === 'arrow'
          ? [current.current, current.start]
          : [current.start, current.current]
      if (TEXT_TOOLS.has(tool)) {
        beginTextEntry(tool, points)
        return
      }
      commit({ tool, points })
      return
    }

    if (current.mode === 'arcDrag' && tool === 'arc') {
      const dist = Math.hypot(
        current.current.x - current.start.x,
        current.current.y - current.start.y,
      )
      if (dist < 2) {
        setDraft({ mode: 'idle' })
        return
      }
      const mid = arcMidFromChord(current.start, current.current, current.bulge)
      commit({ tool: 'arc', points: [current.start, current.current, mid] })
      return
    }

    if (current.mode === 'calloutBox' && tool === 'callout') {
      const box = calloutBoxFromDrag(current.start, current.current, current.tip)
      beginTextEntry(tool, [...box, current.tip])
      return
    }

    if (current.mode === 'cloudArea' && tool === 'cloudCallout') {
      const dist = Math.hypot(
        current.current.x - current.start.x,
        current.current.y - current.start.y,
      )
      const cloud =
        dist < 2
          ? boxAroundPoint(current.start, DEFAULT_CLOUD_SIZE, DEFAULT_CLOUD_SIZE)
          : normalizeBox(current.start, current.current)
      setDraft({
        mode: 'cloudLeader',
        cloud,
        cursor: current.current,
      })
      return
    }

    if (current.mode === 'freehand' && tool && (tool === 'pen' || tool === 'highlighter')) {
      if (current.points.length < 2) {
        setDraft({ mode: 'idle' })
        return
      }
      commit({ tool, points: current.points })
    }
  }

  const onDoubleClick = () => {
    const current = draftRef.current
    if (current.mode === 'poly' && current.points.length >= 2 && tool && POLY_TOOLS.has(tool)) {
      finishPoly(tool, current.points)
    }
  }

  const finishTextEntry = (submit: boolean) => {
    const current = draftRef.current
    if (current.mode !== 'textEntry') {
      return
    }
    if (!submit) {
      cancelDraft()
      return
    }
    if (textEntryCancelledRef.current) {
      textEntryCancelledRef.current = false
      return
    }
    commit({
      tool: current.tool,
      points: current.points,
      contents: current.text,
    })
  }

  return (
    <div
      className="markup-drawing-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <svg aria-hidden="true">
        {renderPreview(draft, tool, style.color, style.strokeWidth, toScreen)}
      </svg>
      {draft.mode === 'textEntry' ? (
        <textarea
          className="markup-text-entry"
          autoFocus
          value={draft.text}
          style={{
            left: draft.box.x,
            top: draft.box.y,
            width: draft.box.width,
            height: draft.box.height,
            color: style.color,
          }}
          aria-label="Markup text"
          onChange={(event) =>
            setDraft((prev) =>
              prev.mode === 'textEntry' ? { ...prev, text: event.target.value } : prev,
            )
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              finishTextEntry(false)
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              finishTextEntry(true)
            }
          }}
          onBlur={() => finishTextEntry(true)}
        />
      ) : null}
    </div>
  )
}

function renderPreview(
  draft: DraftState,
  tool: MarkupTool,
  color: string,
  strokeWidth: number,
  toScreen: (point: MarkupPoint) => { x: number; y: number },
) {
  const stroke = { stroke: color, strokeWidth, fill: 'none' as const }

  if (draft.mode === 'drag') {
    const a = toScreen(draft.start)
    const b = toScreen(draft.current)
    if (tool === 'line') {
      return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...stroke} />
    }
    if (tool === 'arrow') {
      // Tip is start (first click); shaft ends at current.
      return (
        <g>
          <line x1={b.x} y1={b.y} x2={a.x} y2={a.y} {...stroke} />
          {arrowHead(b, a, color)}
        </g>
      )
    }
    if (tool === 'rectangle' || tool === 'textBox') {
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      const w = Math.abs(b.x - a.x)
      const h = Math.abs(b.y - a.y)
      return <rect x={x} y={y} width={w} height={h} {...stroke} />
    }
    if (tool === 'ellipse') {
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      return (
        <ellipse
          cx={cx}
          cy={cy}
          rx={Math.abs(b.x - a.x) / 2}
          ry={Math.abs(b.y - a.y) / 2}
          {...stroke}
        />
      )
    }
  }

  if (draft.mode === 'arcDrag') {
    const mid = arcMidFromChord(draft.start, draft.current, draft.bulge)
    const sampled = sampleArc([draft.start, draft.current, mid]).map(toScreen)
    return (
      <polyline
        points={sampled.map((p) => `${p.x},${p.y}`).join(' ')}
        {...stroke}
      />
    )
  }

  if (draft.mode === 'poly') {
    const pts = [...draft.points]
    if (draft.cursor) {
      pts.push(draft.cursor)
    }
    const screen = pts.map(toScreen)
    const close = tool === 'polygon' || tool === 'cloud'
    const first = screen[0]
    const nearClose =
      close &&
      first &&
      draft.cursor &&
      draft.points.length >= 2 &&
      Math.hypot(screen[screen.length - 1]!.x - first.x, screen[screen.length - 1]!.y - first.y) <=
        CLOSE_SNAP_PX
    return (
      <g>
        <polyline
          points={screen.map((p) => `${p.x},${p.y}`).join(' ')}
          {...stroke}
          strokeDasharray={close ? '4 3' : undefined}
        />
        {first && nearClose ? (
          <circle cx={first.x} cy={first.y} r={5} fill="none" stroke={color} strokeWidth={1.5} />
        ) : null}
      </g>
    )
  }

  if (draft.mode === 'freehand') {
    const screen = draft.points.map(toScreen)
    return (
      <polyline
        points={screen.map((p) => `${p.x},${p.y}`).join(' ')}
        {...stroke}
        strokeOpacity={tool === 'highlighter' ? 0.45 : 1}
        strokeWidth={tool === 'highlighter' ? strokeWidth * 3 : strokeWidth}
      />
    )
  }

  if (draft.mode === 'calloutTip') {
    const tip = toScreen(draft.tip)
    const [a, b] = calloutBoxCorners(draft.cursor, draft.tip, DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT)
    const sa = toScreen(a)
    const sb = toScreen(b)
    const x = Math.min(sa.x, sb.x)
    const y = Math.min(sa.y, sb.y)
    const w = Math.abs(sb.x - sa.x)
    const h = Math.abs(sb.y - sa.y)
    const anchor = toScreen(boxSideAnchor(a, b, draft.tip))
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} {...stroke} strokeDasharray="4 3" />
        <line x1={anchor.x} y1={anchor.y} x2={tip.x} y2={tip.y} {...stroke} />
        {arrowHead(anchor, tip, color)}
        <circle cx={tip.x} cy={tip.y} r={4} fill={color} />
      </g>
    )
  }

  if (draft.mode === 'calloutBox') {
    const [a, b] = calloutBoxFromDrag(draft.start, draft.current, draft.tip)
    const sa = toScreen(a)
    const sb = toScreen(b)
    const tip = toScreen(draft.tip)
    const anchor = toScreen(boxSideAnchor(a, b, draft.tip))
    return (
      <g>
        <rect
          x={Math.min(sa.x, sb.x)}
          y={Math.min(sa.y, sb.y)}
          width={Math.abs(sb.x - sa.x)}
          height={Math.abs(sb.y - sa.y)}
          {...stroke}
        />
        <line x1={anchor.x} y1={anchor.y} x2={tip.x} y2={tip.y} {...stroke} />
        {arrowHead(anchor, tip, color)}
      </g>
    )
  }

  if (draft.mode === 'cloudArea') {
    const [a, b] = normalizeBox(draft.start, draft.current)
    const sa = toScreen(a)
    const sb = toScreen(b)
    const x = Math.min(sa.x, sb.x)
    const y = Math.min(sa.y, sb.y)
    const w = Math.abs(sb.x - sa.x)
    const h = Math.abs(sb.y - sa.y)
    const cloudScreen = [
      { x, y: y + h },
      { x: x + w, y: y + h },
      { x: x + w, y },
      { x, y },
    ]
    return <polygon points={cloudPreviewPoints(cloudScreen)} {...stroke} />
  }

  if (draft.mode === 'cloudLeader') {
    const [a, b] = draft.cloud
    const sa = toScreen(a)
    const sb = toScreen(b)
    const x = Math.min(sa.x, sb.x)
    const y = Math.min(sa.y, sb.y)
    const w = Math.abs(sb.x - sa.x)
    const h = Math.abs(sb.y - sa.y)
    const cloudScreen = [
      { x, y: y + h },
      { x: x + w, y: y + h },
      { x: x + w, y },
      { x, y },
    ]
    const cloudCenter = boxCentre(a, b)
    const [ta, tb] = cloudCalloutTextBox(draft.cursor, draft.cloud)
    const cloudAnchor = toScreen(boxSideAnchor(a, b, boxCentre(ta, tb)))
    const textAnchor = toScreen(boxSideAnchor(ta, tb, cloudCenter))
    const sta = toScreen(ta)
    const stb = toScreen(tb)
    return (
      <g>
        <polygon points={cloudPreviewPoints(cloudScreen)} {...stroke} />
        <line x1={cloudAnchor.x} y1={cloudAnchor.y} x2={textAnchor.x} y2={textAnchor.y} {...stroke} />
        <rect
          x={Math.min(sta.x, stb.x)}
          y={Math.min(sta.y, stb.y)}
          width={Math.abs(stb.x - sta.x)}
          height={Math.abs(stb.y - sta.y)}
          {...stroke}
          strokeDasharray="4 3"
        />
      </g>
    )
  }

  return null
}

function cloudPreviewPoints(
  corners: { x: number; y: number }[],
): string {
  // Lightweight scallop preview for draft (screen space).
  const pts: string[] = []
  const radius = 8
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!
    const b = corners[(i + 1) % corners.length]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const count = Math.max(1, Math.round(len / (radius * 1.6)))
    for (let s = 0; s < count; s += 1) {
      const t0 = s / count
      const t1 = (s + 1) / count
      const x0 = a.x + dx * t0
      const y0 = a.y + dy * t0
      const x1 = a.x + dx * t1
      const y1 = a.y + dy * t1
      const mx = (x0 + x1) / 2
      const my = (y0 + y1) / 2
      const nx = -dy / len
      const ny = dx / len
      // Outward relative to screen CW box
      const cx = mx + nx * radius * 0.55
      const cy = my + ny * radius * 0.55
      pts.push(`${x0},${y0}`)
      pts.push(`${cx},${cy}`)
      if (s === count - 1) {
        pts.push(`${x1},${y1}`)
      }
    }
  }
  return pts.join(' ')
}

function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const size = 10
  const left = { x: to.x - ux * size - uy * size * 0.5, y: to.y - uy * size + ux * size * 0.5 }
  const right = { x: to.x - ux * size + uy * size * 0.5, y: to.y - uy * size - ux * size * 0.5 }
  return (
    <polygon
      points={`${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`}
      fill={color}
    />
  )
}
