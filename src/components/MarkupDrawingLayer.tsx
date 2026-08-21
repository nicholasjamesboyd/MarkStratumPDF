import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { MarkupPoint, MarkupTool } from '../../shared/ipc'
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
  | { mode: 'arc'; points: MarkupPoint[] }
  | { mode: 'poly'; points: MarkupPoint[]; cursor: MarkupPoint | null }
  | { mode: 'freehand'; points: MarkupPoint[] }
  | { mode: 'calloutBox'; start: MarkupPoint; current: MarkupPoint }
  | { mode: 'calloutLeader'; box: [MarkupPoint, MarkupPoint]; tip: MarkupPoint | null }

const DRAG_TOOLS: ReadonlySet<MarkupTool> = new Set([
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'textBox',
])

const POLY_TOOLS: ReadonlySet<MarkupTool> = new Set(['polyline', 'polygon', 'cloud'])
const CALLOUT_TOOLS: ReadonlySet<MarkupTool> = new Set(['callout', 'cloudCallout'])

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

  useEffect(() => {
    setDraft({ mode: 'idle' })
  }, [tool, pageIndex])

  useEffect(() => {
    if (!tool) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraft({ mode: 'idle' })
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
        commit({ tool, points: current.points })
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

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !tool) {
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
      const current = draftRef.current
      if (current.mode === 'arc') {
        const next = [...current.points, point]
        if (next.length >= 3) {
          commit({ tool: 'arc', points: next.slice(0, 3) })
          return
        }
        setDraft({ mode: 'arc', points: next })
        return
      }
      setDraft({ mode: 'arc', points: [point] })
      return
    }
    if (POLY_TOOLS.has(tool)) {
      const current = draftRef.current
      if (current.mode === 'poly') {
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
    if (CALLOUT_TOOLS.has(tool)) {
      const current = draftRef.current
      if (current.mode === 'calloutLeader') {
        commit({
          tool,
          points: [current.box[0], current.box[1], point],
          contents: '',
        })
        return
      }
      setDraft({ mode: 'calloutBox', start: point, current: point })
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = toPagePoint(event.clientX, event.clientY, event.currentTarget)
    setDraft((prev) => {
      if (prev.mode === 'drag' || prev.mode === 'calloutBox') {
        return { ...prev, current: point }
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
      if (prev.mode === 'calloutLeader') {
        return { ...prev, tip: point }
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
      commit({
        tool,
        points: [current.start, current.current],
        contents: tool === 'textBox' ? '' : undefined,
      })
      return
    }

    if (current.mode === 'calloutBox' && tool && CALLOUT_TOOLS.has(tool)) {
      const dist = Math.hypot(
        current.current.x - current.start.x,
        current.current.y - current.start.y,
      )
      if (dist < 2) {
        setDraft({ mode: 'idle' })
        return
      }
      setDraft({
        mode: 'calloutLeader',
        box: [current.start, current.current],
        tip: current.current,
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
      commit({ tool, points: current.points })
    }
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
      <svg aria-hidden="true">{renderPreview(draft, tool, style.color, style.strokeWidth, toScreen)}</svg>
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
    if (tool === 'line' || tool === 'arrow') {
      return (
        <g>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...stroke} />
          {tool === 'arrow' ? arrowHead(a, b, color) : null}
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

  if (draft.mode === 'arc') {
    const pts = draft.points.map(toScreen)
    return (
      <g>
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
        ))}
        {pts.length >= 2 ? (
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} {...stroke} />
        ) : null}
      </g>
    )
  }

  if (draft.mode === 'poly') {
    const pts = [...draft.points]
    if (draft.cursor) {
      pts.push(draft.cursor)
    }
    const screen = pts.map(toScreen)
    const close = tool === 'polygon' || tool === 'cloud'
    return (
      <polyline
        points={screen.map((p) => `${p.x},${p.y}`).join(' ')}
        {...stroke}
        strokeDasharray={close ? '4 3' : undefined}
      />
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

  if (draft.mode === 'calloutBox') {
    const a = toScreen(draft.start)
    const b = toScreen(draft.current)
    return (
      <rect
        x={Math.min(a.x, b.x)}
        y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        {...stroke}
      />
    )
  }

  if (draft.mode === 'calloutLeader') {
    const a = toScreen(draft.box[0])
    const b = toScreen(draft.box[1])
    const tip = draft.tip ? toScreen(draft.tip) : null
    const midX = (Math.min(a.x, b.x) + Math.max(a.x, b.x)) / 2
    const bottom = Math.max(a.y, b.y)
    return (
      <g>
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
          {...stroke}
        />
        {tip ? <line x1={midX} y1={bottom} x2={tip.x} y2={tip.y} {...stroke} /> : null}
      </g>
    )
  }

  return null
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
