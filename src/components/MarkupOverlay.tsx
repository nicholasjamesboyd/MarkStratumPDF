import type { MarkupInfo, MarkupPoint } from '../../shared/ipc'

type MarkupOverlayProps = {
  markups: MarkupInfo[]
  pageIndex: number
  pageHeightPts: number
  scale: number
}

export function MarkupOverlay({
  markups,
  pageIndex,
  pageHeightPts,
  scale,
}: MarkupOverlayProps) {
  const pageMarkups = markups.filter((markup) => markup.pageIndex === pageIndex)
  if (pageMarkups.length === 0) {
    return null
  }

  const toScreen = (point: MarkupPoint) => ({
    x: point.x * scale,
    y: (pageHeightPts - point.y) * scale,
  })

  return (
    <div className="markup-overlay-layer" aria-hidden="true">
      <svg>
        <defs>
          <pattern
            id="markup-hatch-diagonal"
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="8" stroke="currentColor" strokeWidth="1.5" />
          </pattern>
          <pattern
            id="markup-hatch-cross"
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
          >
            <path d="M0 0L8 8M8 0L0 8" stroke="currentColor" strokeWidth="1.2" />
          </pattern>
        </defs>
        {pageMarkups.map((markup) => (
          <g
            key={markup.id}
            style={{
              color: rgbCss(markup.color),
            }}
          >
            {renderMarkup(markup, toScreen, scale)}
          </g>
        ))}
      </svg>
    </div>
  )
}

function renderMarkup(
  markup: MarkupInfo,
  toScreen: (point: MarkupPoint) => { x: number; y: number },
  scale: number,
) {
  const color = rgbCss(markup.color)
  const strokeWidth = Math.max(1, markup.strokeWidth * scale)
  const stroke = { stroke: color, strokeWidth, fill: 'none' as const }
  const points = markup.points.map(toScreen)
  const hatchFill =
    markup.hatch === 'diagonal'
      ? 'url(#markup-hatch-diagonal)'
      : markup.hatch === 'crosshatch'
        ? 'url(#markup-hatch-cross)'
        : 'none'

  switch (markup.tool) {
    case 'line':
      if (points.length < 2) {
        return null
      }
      return (
        <line
          x1={points[0]!.x}
          y1={points[0]!.y}
          x2={points[points.length - 1]!.x}
          y2={points[points.length - 1]!.y}
          {...stroke}
        />
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
    case 'callout':
    case 'cloudCallout': {
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
          {markup.tool === 'callout' || markup.tool === 'cloudCallout'
            ? calloutLeader(markup, toScreen, stroke)
            : null}
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
    case 'arc':
    case 'pen':
      return (
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          {...stroke}
        />
      )
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
    case 'cloud':
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
            strokeDasharray={markup.tool === 'cloud' ? '5 3' : undefined}
          />
        </g>
      )
    default:
      return null
  }
}

function calloutLeader(
  markup: MarkupInfo,
  toScreen: (point: MarkupPoint) => { x: number; y: number },
  stroke: { stroke: string; strokeWidth: number; fill: 'none' },
) {
  if (markup.points.length < 3) {
    return null
  }
  const box = screenBox(markup, toScreen)
  const tip = toScreen(markup.points[markup.points.length - 1]!)
  return (
    <line
      x1={box.x + box.width / 2}
      y1={box.y + box.height}
      x2={tip.x}
      y2={tip.y}
      {...stroke}
    />
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
