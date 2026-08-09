import type { FitMode, ViewMode } from '../../shared/ipc'

type ToolbarProps = {
  fileName: string | null
  viewMode: ViewMode
  zoomPercent: number
  pageIndex: number
  pageCount: number
  busy: boolean
  onOpen: () => void
  onViewModeChange: (mode: ViewMode) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: (mode: FitMode) => void
  onPageChange: (pageIndex: number) => void
}

export function Toolbar({
  fileName,
  viewMode,
  zoomPercent,
  pageIndex,
  pageCount,
  busy,
  onOpen,
  onViewModeChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onPageChange,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">RedColumn</div>
      <div className="toolbar-group">
        <button type="button" className="primary" onClick={onOpen} disabled={busy}>
          Open
        </button>
        <span>{fileName ?? 'No file open'}</span>
      </div>
      <div className="toolbar-group">
        <button
          type="button"
          className={viewMode === 'document' ? 'active' : undefined}
          onClick={() => onViewModeChange('document')}
        >
          Document
        </button>
        <button
          type="button"
          className={viewMode === 'drawing' ? 'active' : undefined}
          onClick={() => onViewModeChange('drawing')}
        >
          Drawing
        </button>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={onZoomOut} disabled={!fileName}>
          -
        </button>
        <span>{zoomPercent}%</span>
        <button type="button" onClick={onZoomIn} disabled={!fileName}>
          +
        </button>
        <button type="button" onClick={() => onFit('width')} disabled={!fileName}>
          Fit width
        </button>
        <button type="button" onClick={() => onFit('page')} disabled={!fileName}>
          Fit page
        </button>
        <button type="button" onClick={() => onFit('custom')} disabled={!fileName}>
          100%
        </button>
      </div>
      <div className="toolbar-group">
        <label htmlFor="page-input">Page</label>
        <input
          id="page-input"
          type="number"
          min={1}
          max={Math.max(pageCount, 1)}
          value={pageCount ? pageIndex + 1 : 1}
          disabled={!fileName}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (!Number.isFinite(next)) {
              return
            }
            onPageChange(Math.min(Math.max(next - 1, 0), Math.max(pageCount - 1, 0)))
          }}
        />
        <span>/ {pageCount || 0}</span>
      </div>
    </header>
  )
}
