import { useMemo, useState, type ReactNode } from 'react'
import type { DocumentInfo, LayerInfo, PageInfo } from '../../shared/ipc'
import type { RecentFileEntry } from '../hooks/useRecentFiles'
import { BookmarksPanel } from './panels/BookmarksPanel'
import { LayersPanel } from './panels/LayersPanel'
import { PagesPanel, type PagesChangedKind } from './panels/PagesPanel'
import { RecentFilesPanel } from './panels/RecentFilesPanel'

type ToolId = 'pages' | 'recent' | 'bookmarks' | 'layers'

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
    requestId: string
  }) => Promise<{ url: string; width: number; height: number; scale: number }>
  onGoToBookmarkPage: (pageIndex: number) => void
  onPagesChanged: (
    result: { document: DocumentInfo; pagesRevision: number },
    kind: PagesChangedKind,
  ) => void
  onLayersChanged: (result: {
    document: DocumentInfo
    layers: LayerInfo[]
    layersRevision: number
  }) => void
  onError: (message: string) => void
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
  onLayersChanged,
  onError,
}: ToolShelfProps) {
  const [activeToolId, setActiveToolId] = useState<ToolId | null>(null)

  const tools = useMemo<ToolDefinition[]>(
    () => [
      {
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
            onError={onError}
          />
        ),
      },
      {
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
      {
        id: 'bookmarks',
        label: 'Bookmarks',
        icon: <BookmarkIcon />,
        renderPanel: () => (
          <BookmarksPanel documentId={documentId} onGoToPage={onGoToBookmarkPage} />
        ),
      },
      {
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
    ],
    [
      documentId,
      layersRevision,
      onClearRecent,
      onError,
      onGoToBookmarkPage,
      onLayersChanged,
      onOpenRecent,
      onPagesChanged,
      pageIndex,
      pages,
      pagesRevision,
      recentEntries,
      renderPageToUrl,
    ],
  )

  const activeTool = tools.find((tool) => tool.id === activeToolId) ?? null
  const panelOpen = activeTool !== null

  const toggleTool = (toolId: ToolId) => {
    setActiveToolId((current) => (current === toolId ? null : toolId))
  }

  return (
    <aside className={`tool-shelf${panelOpen ? ' tool-shelf-open' : ''}`}>
      <div className="tool-shelf-rail" role="toolbar" aria-label="Tool panels">
        {tools.map((tool) => {
          const isActive = tool.id === activeToolId
          return (
            <button
              key={tool.id}
              type="button"
              className={`tool-shelf-rail-button${isActive ? ' active' : ''}`}
              aria-label={tool.label}
              aria-pressed={isActive}
              title={tool.label}
              onClick={() => toggleTool(tool.id)}
            >
              {tool.icon}
            </button>
          )
        })}
      </div>

      {activeTool ? (
        <div className="tool-shelf-panel">
          <div className="tool-shelf-panel-header">
            <h2 className="tool-shelf-panel-title">{activeTool.label}</h2>
          </div>
          <div className="tool-shelf-panel-body">{activeTool.renderPanel()}</div>
        </div>
      ) : null}
    </aside>
  )
}
