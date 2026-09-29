import type { MarkupInfo, MarkupPoint } from '../../shared/ipc'
import {
  boxCentre,
  boxSideAnchor,
  cloudPolylineFromPolygon,
  DEFAULT_CLOUD_ARC_RADIUS,
  sampleArc,
} from '../../shared/markupGeometry'

type MarkupOverlayProps = {
  markups: MarkupInfo[]
  pageIndex: number
  pageHeightPts: number
  scale: number
  selectedId?: string | null
  interactive?: boolean
  hiddenLayerIds?: ReadonlySet<string>
  onSelect?: (markupId: string | null) => void
}

export function MarkupOverlay({
  markups,
  pageIndex,
  pageHeightPts,
  scale,
  selectedId = null,
  interactive = false,
  hiddenLayerIds,
  onSelect,
}: MarkupOverlayProps) {
  const pageMarkups = markups.filter((markup) => {
    if (markup.pageIndex !== pageIndex) {
      return false
    }
    if (markup.layerId && hiddenLayerIds?.has(markup.layerId)) {
      return false
    }
    return true
  })

  if (pageMarkups.length === 0 && !interactive) {
    return null
  }

  const toScreen = (point: MarkupPoint) => ({
    x: point.x * scale,
    y: (pageHeightPts - point.y) * scale,
  })

  return (
    <div
      className={`markup-overlay-layer${interactive ? ' markup-overlay-interactive' : ''}`}
      aria-hidden={!interactive}
      onPointerDown={
        interactive
          ? (event) => {
              if (event.target === event.currentTarget) {
                onSelect?.(null)
              }
            }
          : undefined
      }
    >
      <svg>
        {interactive ? (
          <rect
            className="markup-overlay-deselect"
            x={0}
            y={0}
            width="100%"
            height="100%"
            fill="transparent"
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelect?.(null)
            }}
          />
        ) : null}
        <defs>
          {pageMarkups.map((markup) => hatchDefs(markup, scale))}
        </defs>
        {pageMarkups.map((markup) => (
          <g
            key={markup.id}
            className={selectedId === markup.id ? 'markup-selected' : undefined}
            style={{
              color: rgbCss(markup.hatchColor ?? markup.color),
              cursor: interactive ? 'pointer' : undefined,
            }}
            onPointerDown={
              interactive
                ? (event) => {
                    event.stopPropagation()
                    onSelect?.(markup.id)
                  }
                : undefined
            }
          >
            {renderMarkup(markup, toScreen, scale, selectedId === markup.id)}
          </g>
        ))}
      </svg>
    </div>
  )
}

function hatchDefs(markup: MarkupInfo, scale: number) {
  const spacing = Math.max(4, 8 * (markup.hatchScale || 1) * Math.max(0.5, scale))
  const color = rgbCss(markup.hatchColor ?? markup.color)
  if (markup.hatch === 'none') {
    return null
  }
  if (markup.hatch === 'diagonal') {
    return (
      <pattern
        key={`hatch-d-${markup.id}`}
        id={`markup-hatch-diagonal-${markup.id}`}
        patternUnits="userSpaceOnUse"
        width={spacing}
        height={spacing}
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2={spacing} stroke={color} strokeWidth="1.5" />
      </pattern>
    )
  }
  return (
    <pattern
      key={`hatch-c-${markup.id}`}
      id={`markup-hatch-cross-${markup.id}`}
      patternUnits="userSpaceOnUse"
      width={spacing}
      height={spacing}
    >
      <path
        d={`M0 0L${spacing} ${spacing}M${spacing} 0L0 ${spacing}`}
        stroke={color}
        strokeWidth="1.2"
      />
    </pattern>
  )
}

function renderMarkup(
  markup: MarkupInfo,
  toScreen: (point: MarkupPoint) => { x: number; y: number },
  scale: number,
  selected: boolean,
) {
  const color = rgbCss(markup.color)
  const strokeWidth = Math.max(1, markup.strokeWidth * scale)
  const stroke = {
    stroke: color,
    strokeWidth,
    fill: 'none' as const,
  }
  const points = markup.points.map(toScreen)
  const hatchFill =
    markup.hatch === 'diagonal'
      ? `url(#markup-hatch-diagonal-${markup.id})`
      : markup.hatch === 'crosshatch'
        ? `url(#markup-hatch-cross-${markup.id})`
        : 'none'
  const selectStroke = selected
    ? { stroke: '#2563eb', strokeWidth: strokeWidth + 1, strokeDasharray: '4 3' }
    : null

  switch (markup.tool) {
    case 'line':
      if (points.length < 2) {
        return null
      }
      return (
        <g>
          <line
            x1={points[0]!.x}
            y1={points[0]!.y}
            x2={points[points.length - 1]!.x}
            y2={points[points.length - 1]!.y}
            {...stroke}
          />
          {selectStroke ? (
            <line
              x1={points[0]!.x}
              y1={points[0]!.y}
              x2={points[points.length - 1]!.x}
              y2={points[points.length - 1]!.y}
              fill="none"
              {...selectStroke}
            />
          ) : null}
        </g>
      )
    case 'arrow':
      if (points.length < 2) {
        return null
      }
      return (
        <g>
          <line
            x1={points[0]!.x}
            y1={points[0]!.y}
            x2={points[points.length - 1]!.x}
            y2={points[points.length - 1]!.y}
            {...stroke}
          />
          {arrowHead(points[0]!, points[points.length - 1]!, color)}
        </g>
      )
    case 'rectangle':
    case 'textBox':
    case 'callout': {
      const box = screenBox(markup, toScreen)
      return (
        <g>
          {hatchFill !== 'none' ? (
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill={hatchFill}
              stroke="none"
              opacity={0.85}
            />
          ) : null}
          <rect x={box.x} y={box.y} width={box.width} height={box.height} {...stroke} />
          {markup.tool === 'callout' ? calloutLeader(markup, toScreen, stroke) : null}
          {textContents(markup, box)}
        </g>
      )
    }
    case 'cloudCallout': {
      if (markup.points.length < 4) {
        return null
      }
      const cloudA = toScreen(markup.points[0]!)
      const cloudB = toScreen(markup.points[1]!)
      const textA = toScreen(markup.points[2]!)
      const textB = toScreen(markup.points[3]!)
      const cloudBox = {
        x: Math.min(cloudA.x, cloudB.x),
        y: Math.min(cloudA.y, cloudB.y),
        width: Math.abs(cloudB.x - cloudA.x),
        height: Math.abs(cloudB.y - cloudA.y),
      }
      const textBox = {
        x: Math.min(textA.x, textB.x),
        y: Math.min(textA.y, textB.y),
        width: Math.abs(textB.x - textA.x),
        height: Math.abs(textB.y - textA.y),
      }
      const cloudPts = cloudPolylineFromPolygon(
        [
          { x: cloudBox.x, y: cloudBox.y + cloudBox.height },
          { x: cloudBox.x + cloudBox.width, y: cloudBox.y + cloudBox.height },
          { x: cloudBox.x + cloudBox.width, y: cloudBox.y },
          { x: cloudBox.x, y: cloudBox.y },
        ],
        DEFAULT_CLOUD_ARC_RADIUS * scale,
      )
      const cloudStart = boxCentre(markup.points[0]!, markup.points[1]!)
      const textStart = boxCentre(markup.points[2]!, markup.points[3]!)
      // Leader runs from the cloud edge to the text box edge facing the cloud.
      const leaderStart = toScreen(boxSideAnchor(markup.points[0]!, markup.points[1]!, textStart))
      const leaderEnd = toScreen(boxSideAnchor(markup.points[2]!, markup.points[3]!, cloudStart))
      return (
        <g>
          {hatchFill !== 'none' ? (
            <polygon
              points={cloudPts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={hatchFill}
              stroke="none"
              opacity={0.85}
            />
          ) : null}
          <polygon
            points={cloudPts.map((p) => `${p.x},${p.y}`).join(' ')}
            {...stroke}
          />
          <line x1={leaderStart.x} y1={leaderStart.y} x2={leaderEnd.x} y2={leaderEnd.y} {...stroke} />
          <rect
            x={textBox.x}
            y={textBox.y}
            width={textBox.width}
            height={textBox.height}
            {...stroke}
          />
          {textContents(markup, textBox)}
        </g>
      )
    }
    case 'ellipse': {
      const box = screenBox(markup, toScreen)
      return (
        <g>
          {hatchFill !== 'none' ? (
            <ellipse
              cx={box.x + box.width / 2}
              cy={box.y + box.height / 2}
              rx={box.width / 2}
              ry={box.height / 2}
              fill={hatchFill}
              stroke="none"
              opacity={0.85}
            />
          ) : null}
          <ellipse
            cx={box.x + box.width / 2}
            cy={box.y + box.height / 2}
            rx={box.width / 2}
            ry={box.height / 2}
            {...stroke}
          />
        </g>
      )
    }
    case 'polyline':
    case 'pen':
      return (
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          {...stroke}
        />
      )
    case 'arc': {
      const sampled =
        markup.points.length === 3
          ? sampleArc(markup.points).map(toScreen)
          : points
      return (
        <polyline
          points={sampled.map((point) => `${point.x},${point.y}`).join(' ')}
          {...stroke}
        />
      )
    }
    case 'highlighter':
      return (
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          stroke={color}
          strokeWidth={strokeWidth * 3}
          strokeOpacity={0.4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )
    case 'polygon':
      return (
        <g>
          {hatchFill !== 'none' ? (
            <polygon
              points={points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill={hatchFill}
              stroke="none"
              opacity={0.85}
            />
          ) : null}
          <polygon
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            {...stroke}
          />
        </g>
      )
    case 'cloud': {
      const cloudPts = cloudPolylineFromPolygon(
        markup.points,
        DEFAULT_CLOUD_ARC_RADIUS,
      ).map(toScreen)
      return (
        <g>
          {hatchFill !== 'none' ? (
            <polygon
              points={cloudPts.map((point) => `${point.x},${point.y}`).join(' ')}
              fill={hatchFill}
              stroke="none"
              opacity={0.85}
            />
          ) : null}
          <polygon
            points={cloudPts.map((point) => `${point.x},${point.y}`).join(' ')}
            {...stroke}
          />
        </g>
      )
    }
    default:
      return null
  }
}

function textContents(
  markup: MarkupInfo,
  box: { x: number; y: number; width: number; height: number },
) {
  const text = markup.contents?.trim()
  if (!text) {
    return null
  }
  return (
    <foreignObject x={box.x + 4} y={box.y + 4} width={Math.max(8, box.width - 8)} height={Math.max(8, box.height - 8)}>
      <div className="markup-overlay-text" style={{ color: rgbCss(markup.color) }}>
        {text}
      </div>
    </foreignObject>
  )
}

function calloutLeader(
  markup: MarkupInfo,
  toScreen: (point: MarkupPoint) => { x: number; y: number },
  stroke: { stroke: string; strokeWidth: number; fill: 'none' },
) {
  if (markup.points.length < 3) {
    return null
  }
  const tipPoint = markup.points[markup.points.length - 1]!
  const tip = toScreen(tipPoint)
  const anchor = toScreen(boxSideAnchor(markup.points[0]!, markup.points[1]!, tipPoint))
  return (
    <g>
      <line x1={anchor.x} y1={anchor.y} x2={tip.x} y2={tip.y} {...stroke} />
      {arrowHead(anchor, tip, stroke.stroke)}
    </g>
  )
}

function screenBox(
  markup: MarkupInfo,
  toScreen: (point: MarkupPoint) => { x: number; y: number },
) {
  if (markup.points.length >= 2) {
    const a = toScreen(markup.points[0]!)
    const b = toScreen(markup.points[1]!)
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    }
  }
  const tl = toScreen({ x: markup.bounds.left, y: markup.bounds.top })
  const br = toScreen({ x: markup.bounds.right, y: markup.bounds.bottom })
  return {
    x: Math.min(tl.x, br.x),
    y: Math.min(tl.y, br.y),
    width: Math.abs(br.x - tl.x),
    height: Math.abs(br.y - tl.y),
  }
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

function rgbCss(color: [number, number, number]): string {
  const [r, g, b] = color
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}
