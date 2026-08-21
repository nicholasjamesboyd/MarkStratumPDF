import type { MarkupTool } from '../../shared/ipc'

type MarkupToolIconProps = {
  tool: MarkupTool
}

export function MarkupToolIcon({ tool }: MarkupToolIconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      {iconPath(tool)}
    </svg>
  )
}

function iconPath(tool: MarkupTool) {
  const stroke = {
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (tool) {
    case 'line':
      return <path {...stroke} d="M4 16 16 4" />
    case 'arrow':
      return (
        <>
          <path {...stroke} d="M4 16 14.5 5.5" />
          <path {...stroke} d="M10.5 5.2 14.8 5.2 14.8 9.5" />
        </>
      )
    case 'rectangle':
      return <rect {...stroke} x="4" y="5" width="12" height="10" />
    case 'ellipse':
      return <ellipse {...stroke} cx="10" cy="10" rx="6.5" ry="4.5" />
    case 'arc':
      return <path {...stroke} d="M4 14c0-5 3.5-9 8-9 2.2 0 4.2.9 5.5 2.4" />
    case 'polyline':
      return <path {...stroke} d="M3.5 15.5 7 6.5 12 12.5 16.5 4.5" />
    case 'polygon':
      return <path {...stroke} d="M10 3.5 16 8.2 13.5 15.5H6.5L4 8.2Z" />
    case 'cloud':
      return (
        <path
          {...stroke}
          d="M6.2 13.8c-1.5 0-2.7-1.1-2.7-2.5S4.7 8.8 6.2 8.8c.3-1.7 1.8-3 3.6-3 1.4 0 2.6.8 3.2 1.9.4-.2.8-.3 1.3-.3 1.5 0 2.7 1.1 2.7 2.5s-1.2 2.5-2.7 2.5H6.2z"
        />
      )
    case 'callout':
      return (
        <>
          <rect {...stroke} x="3.5" y="3.5" width="9" height="7" />
          <path {...stroke} d="M8 10.5 12.5 16.5" />
        </>
      )
    case 'cloudCallout':
      return (
        <>
          <path
            {...stroke}
            d="M5.5 10.5c-1.2 0-2.2-.9-2.2-2S4.3 6.5 5.5 6.5c.2-1.3 1.4-2.3 2.8-2.3 1.1 0 2 .6 2.5 1.4.3-.1.6-.2 1-.2 1.2 0 2.1.9 2.1 2s-.9 2-2.1 2H5.5z"
          />
          <path {...stroke} d="M9 10.5 13.5 16.5" />
        </>
      )
    case 'textBox':
      return (
        <>
          <rect {...stroke} x="3.5" y="4.5" width="13" height="11" />
          <path {...stroke} d="M6.5 8.5h7M6.5 11.5h5" />
        </>
      )
    case 'pen':
      return (
        <path
          {...stroke}
          d="M4 15.5c1.5-2.5 3-4 4.2-4.2 1.5-.3 2.2 1.2 3.5.8 1.2-.4 2.2-2.3 4.3-4.6"
        />
      )
    case 'highlighter':
      return (
        <>
          <path {...stroke} d="M5 14.5h10" strokeWidth="3.2" strokeOpacity="0.45" />
          <path {...stroke} d="M6.5 5.5 13.5 12.5" />
          <path {...stroke} d="M12.2 4.8 15.2 7.8 8.2 14.8H5.2v-3z" />
        </>
      )
    default:
      return <circle {...stroke} cx="10" cy="10" r="5" />
  }
}
