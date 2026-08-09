import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

type SplitWorkspaceProps = {
  left: ReactNode
  right: ReactNode
  sizes: [number, number]
  focusedPane: 0 | 1
  onFocusPane: (pane: 0 | 1) => void
  onSizesChange: (sizes: [number, number]) => void
}

export function SplitWorkspace({
  left,
  right,
  sizes,
  focusedPane,
  onFocusPane,
  onSizesChange,
}: SplitWorkspaceProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !shellRef.current) {
      return
    }
    const rect = shellRef.current.getBoundingClientRect()
    if (rect.width < 1) {
      return
    }
    const ratio = (event.clientX - rect.left) / rect.width
    const leftSize = Math.min(0.8, Math.max(0.2, ratio))
    onSizesChange([leftSize, 1 - leftSize])
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      return
    }
    dragging.current = false
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
  }

  return (
    <div ref={shellRef} className="split-workspace">
      <div
        className={`split-pane${focusedPane === 0 ? ' focused' : ''}`}
        style={{ flexBasis: `${sizes[0] * 100}%` }}
        onMouseDown={() => onFocusPane(0)}
      >
        {left}
      </div>
      <div
        className="split-sash"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(sizes[0] * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <div
        className={`split-pane${focusedPane === 1 ? ' focused' : ''}`}
        style={{ flexBasis: `${sizes[1] * 100}%` }}
        onMouseDown={() => onFocusPane(1)}
      >
        {right}
      </div>
    </div>
  )
}
