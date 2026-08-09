import type { ViewMode } from '../../shared/ipc'

type StatusBarProps = {
  viewMode: ViewMode
  pageIndex: number
  pageCount: number
  zoomPercent: number
  busy: boolean
}

export function StatusBar({
  viewMode,
  pageIndex,
  pageCount,
  zoomPercent,
  busy,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>
        {pageCount > 0
          ? `Page ${pageIndex + 1} of ${pageCount}`
          : 'Ready'}
      </span>
      <span>
        {viewMode === 'document' ? 'Document mode' : 'Drawing mode'}
        {' · '}
        {zoomPercent}%
        {busy ? ' · Working…' : ''}
      </span>
    </footer>
  )
}
