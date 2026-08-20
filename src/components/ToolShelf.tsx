import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import type { DocumentInfo, LayerInfo, PageInfo } from '../../shared/ipc'
import type { RecentFileEntry } from '../hooks/useRecentFiles'
import { BookmarksPanel } from './panels/BookmarksPanel'
import { LayersPanel } from './panels/LayersPanel'
import { PagesPanel, type PagesChangedKind } from './panels/PagesPanel'
import { RecentFilesPanel } from './panels/RecentFilesPanel'

const PAGES_PANEL_WIDTH_KEY = 'markstratum.pagesPanelWidth'
const TOOL_ORDER_KEY = 'markstratum.toolOrder'
const TOOL_DRAG_MIME = 'application/x-markstratum-tool-order'
const PAGES_PANEL_DEFAULT_WIDTH = 384
const PAGES_PANEL_MIN_WIDTH = 288
const PAGES_PANEL_MAX_WIDTH = 576

type ToolId = 'pages' | 'recent' | 'bookmarks' | 'layers'

const ALL_TOOL_IDS: ToolId[] = ['recent', 'pages', 'bookmarks', 'layers']
const DEFAULT_TOOL_ORDER: ToolId[] = ['recent', 'pages', 'bookmarks', 'layers']

function readStoredToolOrder(): ToolId[] {
  try {
    const raw = localStorage.getItem(TOOL_ORDER_KEY)
    if (!raw) {
      return [...DEFAULT_TOOL_ORDER]
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_TOOL_ORDER]
    }
    const valid = parsed.filter(
      (id): id is ToolId => typeof id === 'string' && ALL_TOOL_IDS.includes(id as ToolId),
    )
    const missing = ALL_TOOL_IDS.filter((id) => !valid.includes(id))
    if (valid.length === 0) {
      return [...DEFAULT_TOOL_ORDER]
    }
    return [...valid, ...missing]
  } catch {
    return [...DEFAULT_TOOL_ORDER]
  }
}

function reorderToolIds(order: ToolId[], fromIndex: number, insertBefore: number): ToolId[] {
  if (insertBefore === fromIndex || insertBefore === fromIndex + 1) {
    return order
  }
  const next = [...order]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) {
    return order
  }
  const toIndex = fromIndex < insertBefore ? insertBefore - 1 : insertBefore
  next.splice(toIndex, 0, moved)
  return next
}

type ToolDefinition = {
  id: ToolId
  label: string
  icon: ReactNode
  renderPanel: () => ReactNode
}

type ToolShelfProps = {
  recentEntries: RecentFileEntry[]
  onOpenRecent: (filePath: string) => void
  onClearRecent: () => void
  documentId: string | null
  pages: PageInfo[]
  pageIndex: number
  pagesRevision: number
  layersRevision: number
  renderPageToUrl: (req: {
    documentId: string
    pageIndex: number
    scale: number
    rotation?: 0 | 1 | 2 | 3
    requestId: string
  }) => Promise<{ url: string; width: number; height: number; scale: number }>
  onGoToBookmarkPage: (pageIndex: number) => void
  onPagesChanged: (
    result: { document: DocumentInfo; pagesRevision: number },
    kind: PagesChangedKind,
  ) => void
  onOpenFilePath: (filePath: string) => void
  onLayersChanged: (result: {
    document: DocumentInfo
    layers: LayerInfo[]
    layersRevision: number
  }) => void
  onError: (message: string) => void
}

function readStoredPagesWidth(): number {
  try {
    const raw = localStorage.getItem(PAGES_PANEL_WIDTH_KEY)
    const parsed = raw ? Number(raw) : Number.NaN
    if (Number.isFinite(parsed)) {
      return Math.min(PAGES_PANEL_MAX_WIDTH, Math.max(PAGES_PANEL_MIN_WIDTH, parsed))
    }
  } catch {
    // ignore
  }
  return PAGES_PANEL_DEFAULT_WIDTH
}

function PagesIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M6 4.5h8.5v11H6z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M4.5 6v10.5H13"
      />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6.5V10l2.5 1.5"
      />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.5 3.5h9v13l-4.5-3.2L5.5 16.5v-13z"
      />
    </svg>
  )
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 3.5 3.5 7 10 10.5 16.5 7 10 3.5z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 10 10 13.5 16.5 10"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 13 10 16.5 16.5 13"
      />
    </svg>
  )
}

export function ToolShelf({
  recentEntries,
  onOpenRecent,
  onClearRecent,
  documentId,
  pages,
  pageIndex,
  pagesRevision,
  layersRevision,
  renderPageToUrl,
  onGoToBookmarkPage,
  onPagesChanged,
  onOpenFilePath,
  onLayersChanged,
  onError,
}: ToolShelfProps) {
  const [activeToolId, setActiveToolId] = useState<ToolId | null>(null)
  const [toolOrder, setToolOrder] = useState<ToolId[]>(readStoredToolOrder)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overInsertIndex, setOverInsertIndex] = useState<number | null>(null)
  const [pagesPanelWidth, setPagesPanelWidth] = useState(readStoredPagesWidth)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(TOOL_ORDER_KEY, JSON.stringify(toolOrder))
    } catch {
      // ignore
    }
  }, [toolOrder])

  useEffect(() => {
    try {
      localStorage.setItem(PAGES_PANEL_WIDTH_KEY, String(pagesPanelWidth))
    } catch {
      // ignore
    }
  }, [pagesPanelWidth])

  const onResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      resizeRef.current = { startX: event.clientX, startWidth: pagesPanelWidth }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [pagesPanelWidth],
  )

  const onResizePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current
    if (!state) {
      return
    }
    const next = state.startWidth + (event.clientX - state.startX)
    setPagesPanelWidth(Math.min(PAGES_PANEL_MAX_WIDTH, Math.max(PAGES_PANEL_MIN_WIDTH, next)))
  }, [])

  const onResizePointerUp = useCallback(() => {
    resizeRef.current = null
  }, [])

  const toolDefinitions = useMemo<Record<ToolId, ToolDefinition>>(
    () => ({
      pages: {
        id: 'pages',
        label: 'Pages',
        icon: <PagesIcon />,
        renderPanel: () => (
          <PagesPanel
            documentId={documentId}
            pages={pages}
            pageIndex={pageIndex}
            pagesRevision={pagesRevision}
            renderPageToUrl={renderPageToUrl}
            onGoToPage={onGoToBookmarkPage}
            onPagesChanged={onPagesChanged}
            onOpenFilePath={onOpenFilePath}
            onError={onError}
          />
        ),
      },
      recent: {
        id: 'recent',
        label: 'Recent',
        icon: <ClockIcon />,
        renderPanel: () => (
          <RecentFilesPanel
            entries={recentEntries}
            onOpen={onOpenRecent}
            onClear={onClearRecent}
          />
        ),
      },
      bookmarks: {
        id: 'bookmarks',
        label: 'Bookmarks',
        icon: <BookmarkIcon />,
        renderPanel: () => (
          <BookmarksPanel documentId={documentId} onGoToPage={onGoToBookmarkPage} />
        ),
      },
      layers: {
        id: 'layers',
        label: 'Layers',
        icon: <LayersIcon />,
        renderPanel: () => (
          <LayersPanel
            documentId={documentId}
            layersRevision={layersRevision}
            onLayersChanged={onLayersChanged}
            onError={onError}
          />
        ),
      },
    }),
    [
      documentId,
      layersRevision,
      onClearRecent,
      onError,
      onGoToBookmarkPage,
      onLayersChanged,
      onOpenFilePath,
      onOpenRecent,
      onPagesChanged,
      pageIndex,
      pages,
      pagesRevision,
      recentEntries,
      renderPageToUrl,
    ],
  )

  const tools = useMemo(
    () => toolOrder.map((id) => toolDefinitions[id]).filter((tool): tool is ToolDefinition => tool !== undefined),
    [toolDefinitions, toolOrder],
  )

  const activeTool = tools.find((tool) => tool.id === activeToolId) ?? null
  const panelOpen = activeTool !== null
  const isPagesPanel = activeTool?.id === 'pages'

  const toggleTool = (toolId: ToolId) => {
    setActiveToolId((current) => (current === toolId ? null : toolId))
  }

  const clearDrag = () => {
    setDragIndex(null)
    setOverInsertIndex(null)
  }

  const onToolDragStart = (event: DragEvent<HTMLButtonElement>, index: number) => {
    suppressClickRef.current = false
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TOOL_DRAG_MIME, toolOrder[index] ?? '')
  }

  const onToolDragOver = (event: DragEvent<HTMLButtonElement>, index: number) => {
    if (!event.dataTransfer.types.includes(TOOL_DRAG_MIME)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const insertBefore = event.clientY < rect.top + rect.height / 2 ? index : index + 1
    if (overInsertIndex !== insertBefore) {
      setOverInsertIndex(insertBefore)
    }
  }

  const onToolDrop = (event: DragEvent<HTMLElement>, insertBefore: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (!event.dataTransfer.types.includes(TOOL_DRAG_MIME) || dragIndex === null) {
      clearDrag()
      return
    }
    suppressClickRef.current = true
    setToolOrder((prev) => reorderToolIds(prev, dragIndex, insertBefore))
    clearDrag()
  }

  const onRailDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(TOOL_DRAG_MIME)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const onEndDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(TOOL_DRAG_MIME)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (overInsertIndex !== tools.length) {
      setOverInsertIndex(tools.length)
    }
  }

  return (
    <aside className={`tool-shelf${panelOpen ? ' tool-shelf-open' : ''}`}>
      <div
        className="tool-shelf-rail"
        role="toolbar"
        aria-label="Tool panels"
        onDragOver={onRailDragOver}
      >
        {tools.map((tool, index) => {
          const isActive = tool.id === activeToolId
          const isDragging = dragIndex === index
          const isNoOpInsert = (insertBefore: number) =>
            dragIndex !== null && (insertBefore === dragIndex || insertBefore === dragIndex + 1)
          const dropBefore =
            overInsertIndex === index && dragIndex !== null && !isNoOpInsert(index)
          const dropAfter =
            overInsertIndex === index + 1 && dragIndex !== null && !isNoOpInsert(index + 1)
          const className = [
            'tool-shelf-rail-button',
            isActive ? 'active' : '',
            isDragging ? 'dragging' : '',
            dropBefore ? 'drop-before' : '',
            dropAfter ? 'drop-after' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={tool.id}
              type="button"
              className={className}
              aria-label={tool.label}
              aria-pressed={isActive}
              title={tool.label}
              draggable
              onDragStart={(event) => onToolDragStart(event, index)}
              onDragOver={(event) => onToolDragOver(event, index)}
              onDrop={(event) => onToolDrop(event, index)}
              onDragEnd={clearDrag}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                toggleTool(tool.id)
              }}
            >
              {tool.icon}
            </button>
          )
        })}
        <div
          className={`tool-shelf-rail-drop-end${overInsertIndex === tools.length ? ' drop-before' : ''}`}
          onDragOver={onEndDragOver}
          onDrop={(event) => onToolDrop(event, tools.length)}
        />
      </div>

      {activeTool ? (
        <div
          className={`tool-shelf-panel${isPagesPanel ? ' pages-tool-panel' : ''}`}
          style={isPagesPanel ? { width: pagesPanelWidth } : undefined}
        >
          <div className="tool-shelf-panel-header">
            <h2 className="tool-shelf-panel-title">{activeTool.label}</h2>
          </div>
          <div className="tool-shelf-panel-body">{activeTool.renderPanel()}</div>
          {isPagesPanel ? (
            <div
              className="pages-panel-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize pages panel"
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerUp}
            />
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
