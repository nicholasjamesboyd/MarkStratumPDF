import { useEffect, useRef, useState } from 'react'

type PagesPanelToolbarProps = {
  hasSelection: boolean
  pageCount: number
  selectedCount: number
  minSelectedIndex: number
  busy: boolean
  onInsertBlank: () => void
  onInsertFromFile: () => void
  onExtract: () => void
  onDelete: () => void
  onSplit: () => void
  onRotateLeft: () => void
  onRotateRight: () => void
  onReplaceFromFile: () => void
  onCrop: () => void
}

export function PagesPanelToolbar({
  hasSelection,
  pageCount,
  selectedCount,
  minSelectedIndex,
  busy,
  onInsertBlank,
  onInsertFromFile,
  onExtract,
  onDelete,
  onSplit,
  onRotateLeft,
  onRotateRight,
  onReplaceFromFile,
  onCrop,
}: PagesPanelToolbarProps) {
  const [insertOpen, setInsertOpen] = useState(false)
  const insertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!insertOpen) {
      return
    }
    const onPointerDown = (event: MouseEvent) => {
      if (insertRef.current && !insertRef.current.contains(event.target as Node)) {
        setInsertOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [insertOpen])

  const canDelete = hasSelection && selectedCount < pageCount
  const canSplit = hasSelection && minSelectedIndex > 0 && minSelectedIndex < pageCount

  return (
    <div className="pages-panel-toolbar" role="toolbar" aria-label="Page tools">
      <div className="pages-panel-toolbar-group" ref={insertRef}>
        <button
          type="button"
          className="pages-panel-tool"
          title="Insert"
          disabled={busy}
          aria-expanded={insertOpen}
          onClick={() => setInsertOpen((open) => !open)}
        >
          Insert
        </button>
        {insertOpen ? (
          <div className="pages-panel-tool-menu">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setInsertOpen(false)
                onInsertBlank()
              }}
            >
              Blank page
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setInsertOpen(false)
                onInsertFromFile()
              }}
            >
              From file…
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="pages-panel-tool"
        title="Extract selected pages"
        disabled={busy || !hasSelection}
        onClick={onExtract}
      >
        Extract
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Delete selected pages"
        disabled={busy || !canDelete}
        onClick={onDelete}
      >
        Delete
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Split at selected page"
        disabled={busy || !canSplit}
        onClick={onSplit}
      >
        Split
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Rotate left"
        disabled={busy || !hasSelection}
        onClick={onRotateLeft}
      >
        ↺
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Rotate right"
        disabled={busy || !hasSelection}
        onClick={onRotateRight}
      >
        ↻
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Replace from file"
        disabled={busy || !hasSelection}
        onClick={onReplaceFromFile}
      >
        Replace
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Crop selected pages"
        disabled={busy || !hasSelection}
        onClick={onCrop}
      >
        Crop
      </button>
    </div>
  )
}
