import { useEffect, useRef, useState, type ReactNode } from 'react'

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

function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

function InsertIcon() {
  return (
    <ToolIcon>
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
        d="M9.25 2.4V5H12M8 7.25v4M6 9.25h4"
      />
    </ToolIcon>
  )
}

function ExtractIcon() {
  return (
    <ToolIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M3.25 2.5h6.5v11h-6.5z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11 5.5h2.5M13.5 5.5 11.75 3.75M13.5 5.5l-1.75 1.75"
      />
    </ToolIcon>
  )
}

function DeleteIcon() {
  return (
    <ToolIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.25 4.5h9.5M6 4.5V3.25h4V4.5M5.25 4.5l.5 8.25h4.5l.5-8.25"
      />
    </ToolIcon>
  )
}

function SplitPagesIcon() {
  return (
    <ToolIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M2.5 2.5h4.25v11H2.5zM9.25 2.5H13.5v11H9.25z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M8 4.5v7"
      />
    </ToolIcon>
  )
}

function RotateLeftIcon() {
  return (
    <ToolIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 3.5 3.5 5.25 5.25 7"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M3.5 5.25h5.25a3.5 3.5 0 1 1-1 6.85"
      />
    </ToolIcon>
  )
}

function RotateRightIcon() {
  return (
    <ToolIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.75 3.5 12.5 5.25 10.75 7"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M12.5 5.25H7.25a3.5 3.5 0 1 0 1 6.85"
      />
    </ToolIcon>
  )
}

function ReplaceIcon() {
  return (
    <ToolIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 5.25H11l-1.5-1.5M11.5 10.75H5l1.5 1.5"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        d="M4 2.75h5.25L12 5.5v2.25M12 13.25H6.75L4 10.5V8.25"
      />
    </ToolIcon>
  )
}

function CropIcon() {
  return (
    <ToolIcon>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 2.5v9H13.5M11.5 13.5v-9H2.5"
      />
    </ToolIcon>
  )
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
          aria-label="Insert"
          disabled={busy}
          aria-expanded={insertOpen}
          onClick={() => setInsertOpen((open) => !open)}
        >
          <InsertIcon />
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
        aria-label="Extract selected pages"
        disabled={busy || !hasSelection}
        onClick={onExtract}
      >
        <ExtractIcon />
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Delete selected pages"
        aria-label="Delete selected pages"
        disabled={busy || !canDelete}
        onClick={onDelete}
      >
        <DeleteIcon />
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Split at selected page"
        aria-label="Split at selected page"
        disabled={busy || !canSplit}
        onClick={onSplit}
      >
        <SplitPagesIcon />
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Rotate left"
        aria-label="Rotate left"
        disabled={busy || !hasSelection}
        onClick={onRotateLeft}
      >
        <RotateLeftIcon />
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Rotate right"
        aria-label="Rotate right"
        disabled={busy || !hasSelection}
        onClick={onRotateRight}
      >
        <RotateRightIcon />
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Replace from file"
        aria-label="Replace from file"
        disabled={busy || !hasSelection}
        onClick={onReplaceFromFile}
      >
        <ReplaceIcon />
      </button>
      <button
        type="button"
        className="pages-panel-tool"
        title="Crop selected pages"
        aria-label="Crop selected pages"
        disabled={busy || !hasSelection}
        onClick={onCrop}
      >
        <CropIcon />
      </button>
    </div>
  )
}
