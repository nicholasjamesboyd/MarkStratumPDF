import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { MarkupInfo, MarkupPoint, MarkupTool } from '../../shared/ipc'
import { sampleArc } from '../../shared/markupGeometry'

type MarkupEditLayerProps = {
  markup: MarkupInfo
  pageHeightPts: number
  scale: number
  onChangePoints: (points: MarkupPoint[]) => void
  onCommit: (points: MarkupPoint[]) => void
}

type DragState =
  | { kind: 'move'; origin: MarkupPoint; startPoints: MarkupPoint[] }
  | { kind: 'vertex'; index: number; startPoints: MarkupPoint[] }
  | { kind: 'resize'; handle: ResizeHandle; startPoints: MarkupPoint[]; startBox: Box }
  | null

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type Box = { left: number; bottom: number; right: number; top: number }

const BOX_TOOLS: ReadonlySet<MarkupTool> = new Set([
  'rectangle',
  'ellipse',
  'textBox',
  'callout',
])

const VERTEX_TOOLS: ReadonlySet<MarkupTool> = new Set([
  'line',
  'arrow',
  'polyline',
  'polygon',
  'cloud',
  'arc',
])

export function MarkupEditLayer({
  markup,
  pageHeightPts,
  scale,
  onChangePoints,
  onCommit,
}: MarkupEditLayerProps) {
  const [drag, setDrag] = useState<DragState>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pointsRef = useRef(markup.points)
  pointsRef.current = markup.points
  const dragRef = useRef(drag)
  dragRef.current = drag

  const toPagePoint = (clientX: number, clientY: number): MarkupPoint => {
    const target = rootRef.current
    if (!target) {
      return { x: 0, y: 0 }
    }
    const rect = target.getBoundingClientRect()
    const x = (clientX - rect.left) / scale
    const yFromTop = (clientY - rect.top) / scale
    return { x, y: pageHeightPts - yFromTop }
  }

  const toScreen = (point: MarkupPoint) => ({
    x: point.x * scale,
    y: (pageHeightPts - point.y) * scale,
  })

  const onPointerDownMove = (event: ReactPointerEvent) => {
    if (event.button !== 0) {
      return
    }
    event.stopPropagation()
    event.preventDefault()
    const point = toPagePoint(event.clientX, event.clientY)
    rootRef.current?.setPointerCapture(event.pointerId)
    setDrag({ kind: 'move', origin: point, startPoints: clonePoints(markup.points) })
  }

  const onPointerDownVertex = (index: number, event: ReactPointerEvent) => {
    if (event.button !== 0) {
      return
    }
    event.stopPropagation()
    event.preventDefault()
    rootRef.current?.setPointerCapture(event.pointerId)
    setDrag({ kind: 'vertex', index, startPoints: clonePoints(markup.points) })
  }

  const onPointerDownResize = (handle: ResizeHandle, event: ReactPointerEvent) => {
    if (event.button !== 0) {
      return
    }
    event.stopPropagation()
    event.preventDefault()
    rootRef.current?.setPointerCapture(event.pointerId)
    const box = boxFromPoints(markup.points)
    setDrag({
      kind: 'resize',
      handle,
      startPoints: clonePoints(markup.points),
      startBox: box,
    })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current
    if (!current) {
      return
    }
    const point = toPagePoint(event.clientX, event.clientY)

    if (current.kind === 'move') {
      const dx = point.x - current.origin.x
      const dy = point.y - current.origin.y
      onChangePoints(
        current.startPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      )
      return
    }

    if (current.kind === 'vertex') {
      const next = clonePoints(current.startPoints)
      next[current.index] = point
      onChangePoints(next)
      return
    }

    if (current.kind === 'resize') {
      const nextBox = resizeBox(current.startBox, current.handle, point)
      onChangePoints(pointsFromBox(current.startPoints, nextBox, markup.tool))
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    if (dragRef.current) {
      onCommit(pointsRef.current)
      setDrag(null)
    }
  }

  const screenPoints = markup.points.map(toScreen)
  const box = screenBoxFromPoints(markup.points, toScreen)
  const handles = BOX_TOOLS.has(markup.tool) ? resizeHandles(box) : []
  const vertices = vertexIndices(markup)

  return (
    <div
      ref={rootRef}
      className="markup-edit-layer"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg>
        <rect
          className="markup-edit-bounds"
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          onPointerDown={onPointerDownMove}
        />
        {markup.tool === 'arc' && markup.points.length >= 3
          ? (
              <polyline
                className="markup-edit-guide"
                points={sampleArc(markup.points)
                  .map(toScreen)
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
              />
            )
          : null}
        {handles.map((handle) => (
          <rect
            key={handle.id}
            className="markup-edit-handle"
            x={handle.x - 4}
            y={handle.y - 4}
            width={8}
            height={8}
            onPointerDown={(event) => onPointerDownResize(handle.id, event)}
          />
        ))}
        {vertices.map((index) => {
          const p = screenPoints[index]
          if (!p) {
            return null
          }
          return (
            <circle
              key={`v-${index}`}
              className="markup-edit-handle markup-edit-vertex"
              cx={p.x}
              cy={p.y}
              r={5}
              onPointerDown={(event) => onPointerDownVertex(index, event)}
            />
          )
        })}
      </svg>
    </div>
  )
}

function vertexIndices(markup: MarkupInfo): number[] {
  if (markup.tool === 'pen' || markup.tool === 'highlighter') {
    return []
  }
  if (markup.tool === 'arc') {
    return markup.points.length >= 3 ? [0, 1, 2] : markup.points.map((_, i) => i)
  }
  if (markup.tool === 'cloudCallout') {
    // Cloud corners + text box corners
    return markup.points.length >= 4 ? [0, 1, 2, 3] : []
  }
  if (markup.tool === 'callout') {
    return markup.points.length >= 3 ? [markup.points.length - 1] : []
  }
  if (VERTEX_TOOLS.has(markup.tool) || markup.tool === 'line' || markup.tool === 'arrow') {
    return markup.points.map((_, i) => i)
  }
  return []
}

function clonePoints(points: MarkupPoint[]): MarkupPoint[] {
  return points.map((p) => ({ x: p.x, y: p.y }))
}

function boxFromPoints(points: MarkupPoint[]): Box {
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
  return { left, right, bottom, top }
}

function screenBoxFromPoints(
  points: MarkupPoint[],
  toScreen: (p: MarkupPoint) => { x: number; y: number },
) {
  const box = boxFromPoints(points)
  const a = toScreen({ x: box.left, y: box.top })
  const b = toScreen({ x: box.right, y: box.bottom })
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function resizeHandles(box: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = box
  const cx = x + width / 2
  const cy = y + height / 2
  return [
    { id: 'nw' as const, x, y },
    { id: 'n' as const, x: cx, y },
    { id: 'ne' as const, x: x + width, y },
    { id: 'e' as const, x: x + width, y: cy },
    { id: 'se' as const, x: x + width, y: y + height },
    { id: 's' as const, x: cx, y: y + height },
    { id: 'sw' as const, x, y: y + height },
    { id: 'w' as const, x, y: cy },
  ]
}

function resizeBox(start: Box, handle: ResizeHandle, point: MarkupPoint): Box {
  const next = { ...start }
  if (handle.includes('w')) {
    next.left = Math.min(point.x, start.right - 2)
  }
  if (handle.includes('e')) {
    next.right = Math.max(point.x, start.left + 2)
  }
  if (handle.includes('s')) {
    // screen s is visually down = lower PDF y? screen y increases down; PDF y increases up.
    // Our pointer is already in PDF space, so "s" handle is at bottom of screen box = lower PDF top? 
    // screenBox uses top PDF as smaller screen y. Handle 's' is at max screen y = min PDF y (bottom).
    next.bottom = Math.min(point.y, start.top - 2)
  }
  if (handle.includes('n')) {
    next.top = Math.max(point.y, start.bottom + 2)
  }
  return next
}

function pointsFromBox(
  startPoints: MarkupPoint[],
  box: Box,
  tool: MarkupTool,
): MarkupPoint[] {
  if (tool === 'callout') {
    const tip = startPoints[startPoints.length - 1] ?? {
      x: box.right + 20,
      y: box.top + 20,
    }
    return [
      { x: box.left, y: box.bottom },
      { x: box.right, y: box.top },
      tip,
    ]
  }
  return [
    { x: box.left, y: box.bottom },
    { x: box.right, y: box.top },
  ]
}
