import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { FitMode, ViewMode } from '../../shared/ipc'

function DocumentModeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M4 2.25h5.25L12 5v8.75H4z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M9.25 2.4V5H12M5.75 7.5h4.5M5.75 10h4.5"
      />
    </svg>
  )
}

function DrawingModeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 1.75v12.5M1.75 8h12.5M8 1.75 6 3.75M8 1.75l2 2M8 14.25 6 12.25M8 14.25l2-2M1.75 8 3.75 6M1.75 8l2 2M14.25 8 12.25 6M14.25 8l-2 2"
      />
    </svg>
  )
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M2.5 2.5h11v11h-11zM8 2.5v11"
      />
    </svg>
  )
}

type ToolbarProps = {
  hasDocument: boolean
  viewMode: ViewMode
  zoomPercent: number
  pageIndex: number
  pageCount: number
  splitActive: boolean
  canSplit: boolean
  onViewModeChange: (mode: ViewMode) => void
  onToggleSplit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: (mode: FitMode) => void
  onPageChange: (pageIndex: number) => void
}

export function Toolbar({
  hasDocument,
  viewMode,
  zoomPercent,
  pageIndex,
  pageCount,
  splitActive,
  canSplit,
  onViewModeChange,
  onToggleSplit,
  onZoomIn,
  onZoomOut,
  onFit,
  onPageChange,
}: ToolbarProps) {
  const displayPage = pageCount ? pageIndex + 1 : 1
  const [pageDraft, setPageDraft] = useState(String(displayPage))

  useEffect(() => {
    setPageDraft(String(displayPage))
  }, [displayPage])

  const canNavigate = hasDocument && pageCount > 0
  const canGoPrev = canNavigate && pageIndex > 0
  const canGoNext = canNavigate && pageIndex < pageCount - 1

  const goToPageNumber = (raw: string) => {
    const next = Number(raw)
    if (!Number.isFinite(next) || pageCount < 1) {
      setPageDraft(String(displayPage))
      return
    }
    const clampedIndex = Math.min(Math.max(Math.trunc(next) - 1, 0), pageCount - 1)
    onPageChange(clampedIndex)
    setPageDraft(String(clampedIndex + 1))
  }

  const onPageSubmit = (event: FormEvent) => {
    event.preventDefault()
    goToPageNumber(pageDraft)
  }

  const onPageKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setPageDraft(String(displayPage))
      event.currentTarget.blur()
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={viewMode === 'document' ? 'icon-button active' : 'icon-button'}
          title="Document mode: scroll through pages"
          aria-label="Document mode: scroll through pages"
          disabled={!hasDocument}
          onClick={() => onViewModeChange('document')}
        >
          <DocumentModeIcon />
        </button>
        <button
          type="button"
          className={viewMode === 'drawing' ? 'icon-button active' : 'icon-button'}
          title="Drawing mode: pan around the page"
          aria-label="Drawing mode: pan around the page"
          disabled={!hasDocument}
          onClick={() => onViewModeChange('drawing')}
        >
          <DrawingModeIcon />
        </button>
        <button
          type="button"
          className={splitActive ? 'icon-button active' : 'icon-button'}
          title={splitActive ? 'Exit split view' : 'Split view side by side'}
          aria-label={splitActive ? 'Exit split view' : 'Split view side by side'}
          disabled={!canSplit && !splitActive}
          onClick={onToggleSplit}
        >
          <SplitIcon />
        </button>
      </div>
      <div className="toolbar-group">
        <button type="button" onClick={onZoomOut} disabled={!hasDocument}>
          -
        </button>
        <span>{zoomPercent}%</span>
        <button type="button" onClick={onZoomIn} disabled={!hasDocument}>
          +
        </button>
        <button type="button" onClick={() => onFit('width')} disabled={!hasDocument}>
          Fit width
        </button>
        <button type="button" onClick={() => onFit('page')} disabled={!hasDocument}>
          Fit page
        </button>
        <button type="button" onClick={() => onFit('custom')} disabled={!hasDocument}>
          100%
        </button>
      </div>
      <div className="toolbar-group">
        <button
          type="button"
          aria-label="Previous page"
          disabled={!canGoPrev}
          onClick={() => onPageChange(pageIndex - 1)}
        >
          Prev
        </button>
        <form className="page-form" onSubmit={onPageSubmit}>
          <label htmlFor="page-input">Page</label>
          <input
            id="page-input"
            type="number"
            min={1}
            max={Math.max(pageCount, 1)}
            value={pageDraft}
            disabled={!canNavigate}
            onChange={(event) => setPageDraft(event.target.value)}
            onBlur={() => goToPageNumber(pageDraft)}
            onKeyDown={onPageKeyDown}
          />
          <span>/ {pageCount || 0}</span>
        </form>
        <button
          type="button"
          aria-label="Next page"
          disabled={!canGoNext}
          onClick={() => onPageChange(pageIndex + 1)}
        >
          Next
        </button>
      </div>
    </header>
  )
}
