import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FitMode, LayerInfo, MarkupInfo, MarkupTool, ViewMode } from '../shared/ipc'
import { MarkupListPanel } from './components/MarkupListPanel'
import { PasswordDialog } from './components/PasswordDialog'
import { PdfViewport } from './components/PdfViewport'
import { SplitWorkspace } from './components/SplitWorkspace'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { ToolShelf } from './components/ToolShelf'
import { Toolbar } from './components/Toolbar'
import { useRecentFiles } from './hooks/useRecentFiles'
import { useMarkups } from './hooks/useMarkups'
import { useWorkspace, type TabState } from './hooks/useWorkspace'
import {
  DEFAULT_MARKUP_STYLE,
  authorOrUnknown,
  hexToRgb01,
  readAuthorName,
  type MarkupDrawStyle,
} from './markup/markupState'

const ZOOM_STEP = 1.15

export default function App() {
  const { entries: recentEntries, recordOpen, clear: clearRecent } = useRecentFiles()
  const {
    tabs,
    layout,
    focusedPane,
    focusedTab,
    focusedTabId,
    busy,
    error,
    setError,
    passwordPromptPath,
    setPasswordPromptPath,
    openPath,
    openDialog,
    closeTab,
    closeFocusedTab,
    saveFocusedDocument,
    saveFocusedDocumentAs,
    submitPassword,
    renderPageToUrl,
    applyOpenResult,
    activateTabInFocusedPane,
    updateTab,
    reorderTabs,
    toggleSplit,
    setSplitSizes,
    setFocusedPane,
    setFormValuesForDocument,
    applyLayersChanged,
    applyBookmarksChanged,
    applyMarkupsChanged,
    applyPagesChanged,
  } = useWorkspace({ onDocumentOpened: recordOpen })

  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 })
  const [activeMarkupTool, setActiveMarkupTool] = useState<MarkupTool | null>(null)
  const [markupStyle, setMarkupStyle] = useState<MarkupDrawStyle>(DEFAULT_MARKUP_STYLE)
  const [markupAuthor, setMarkupAuthor] = useState(() => authorOrUnknown(readAuthorName()))
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null)
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [layers, setLayers] = useState<LayerInfo[]>([])
  const startupOpenPathRef = useRef<string | null | undefined>(undefined)

  const { markups, createMarkup, updateMarkup, deleteMarkup, flattenMarkups, patchLocalPoints } =
    useMarkups({
      documentId: focusedTab?.document.documentId ?? null,
      markupsRevision: focusedTab?.markupsRevision ?? 0,
      onPersisted: applyMarkupsChanged,
      onError: setError,
    })

  const selectedMarkup: MarkupInfo | null = useMemo(
    () => markups.find((item) => item.id === selectedMarkupId) ?? null,
    [markups, selectedMarkupId],
  )

  const hiddenLayerIds = useMemo(() => {
    const hidden = new Set<string>()
    const walk = (nodes: LayerInfo[]) => {
      for (const node of nodes) {
        if (!node.visible) {
          hidden.add(node.id)
        }
        if (node.children?.length) {
          walk(node.children)
        }
      }
    }
    walk(layers)
    return hidden
  }, [layers])

  useEffect(() => {
    const documentId = focusedTab?.document.documentId
    if (!documentId || !window.markStratum) {
      setLayers([])
      return
    }
    let active = true
    void window.markStratum.getLayers(documentId).then((next) => {
      if (active) {
        setLayers(next)
      }
    }).catch((error: unknown) => {
      setError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      active = false
    }
  }, [focusedTab?.document.documentId, focusedTab?.layersRevision, setError])

  useEffect(() => {
    setSelectedMarkupId(null)
    setActiveLayerId(null)
  }, [focusedTab?.document.documentId])

  useEffect(() => {
    if (activeMarkupTool) {
      setSelectedMarkupId(null)
    }
  }, [activeMarkupTool])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedMarkupId(null)
        return
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedMarkupId &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault()
        deleteMarkup(selectedMarkupId)
        setSelectedMarkupId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteMarkup, selectedMarkupId])

  const currentPage = focusedTab?.document.pages[focusedTab.pageIndex]

  const applyFit = useCallback(
    (mode: FitMode) => {
      if (!focusedTab) {
        return
      }
      if (!currentPage) {
        if (mode === 'custom') {
          updateTab(focusedTab.id, { scale: 1 })
        }
        return
      }
      if (mode === 'custom') {
        updateTab(focusedTab.id, { scale: 1 })
        return
      }
      const paneFraction = layout?.mode === 'split' ? layout.sizes[focusedPane] : 1
      const availableWidth = Math.max(200, viewportSize.width * paneFraction - 48)
      const availableHeight = Math.max(200, viewportSize.height - 24)
      if (mode === 'width') {
        updateTab(focusedTab.id, { scale: clampScale(availableWidth / currentPage.width) })
        return
      }
      const widthScale = availableWidth / currentPage.width
      const heightScale = availableHeight / currentPage.height
      updateTab(focusedTab.id, { scale: clampScale(Math.min(widthScale, heightScale)) })
    },
    [
      currentPage,
      focusedPane,
      focusedTab,
      layout,
      updateTab,
      viewportSize.height,
      viewportSize.width,
    ],
  )

  useEffect(() => {
    const update = () => {
      setViewportSize({
        width: Math.max(320, window.innerWidth),
        height: Math.max(240, window.innerHeight - 96),
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (!window.markStratum) {
      setError('MarkStratum failed to start its desktop bridge. Rebuild or reinstall the app.')
      return
    }
    const offOpen = window.markStratum.onMenuOpen(() => {
      void openDialog()
    })
    const offClose = window.markStratum.onMenuClose(() => {
      void closeFocusedTab()
    })
    const offSave = window.markStratum.onMenuSave(() => {
      void saveFocusedDocument()
    })
    const offSaveAs = window.markStratum.onMenuSaveAs(() => {
      void saveFocusedDocumentAs()
    })
    const offFlatten = window.markStratum.onMenuFlatten(() => {
      if (!focusedTab) {
        return
      }
      const ok = window.confirm(
        'Flatten burns markups into the page in this session. Save to keep the change, or close without saving to discard it.',
      )
      if (!ok) {
        return
      }
      void flattenMarkups().then((didFlatten) => {
        if (didFlatten) {
          setSelectedMarkupId(null)
        }
      })
    })
    const offMode = window.markStratum.onMenuSetViewMode((mode) => {
      if (!focusedTabId) {
        return
      }
      updateTab(focusedTabId, { viewMode: mode })
    })
    const offZoom = window.markStratum.onMenuZoom((command) => {
      if (!focusedTabId || !focusedTab) {
        return
      }
      if (command === 'in') {
        updateTab(focusedTabId, { scale: clampScale(focusedTab.scale * ZOOM_STEP) })
      } else if (command === 'out') {
        updateTab(focusedTabId, { scale: clampScale(focusedTab.scale / ZOOM_STEP) })
      } else if (command === 'actual') {
        updateTab(focusedTabId, { scale: 1 })
      } else if (command === 'fitWidth') {
        applyFit('width')
      } else if (command === 'fitPage') {
        applyFit('page')
      }
    })
    const offSplit = window.markStratum.onMenuToggleSplit(() => {
      toggleSplit()
    })
    const offPath = window.markStratum.onOpenPath((filePath) => {
      void openPath(filePath)
    })
    const offResult = window.markStratum.onOpenResult((result) => {
      applyOpenResult(result)
    })
    return () => {
      offOpen()
      offClose()
      offSave()
      offSaveAs()
      offFlatten()
      offMode()
      offZoom()
      offSplit()
      offPath()
      offResult()
    }
  }, [
    applyFit,
    applyOpenResult,
    closeFocusedTab,
    flattenMarkups,
    focusedTab,
    focusedTabId,
    openDialog,
    openPath,
    saveFocusedDocument,
    saveFocusedDocumentAs,
    setError,
    toggleSplit,
    updateTab,
  ])

  useEffect(() => {
    if (!window.markStratum) {
      return
    }
    let active = true
    void (async () => {
      if (startupOpenPathRef.current === undefined) {
        startupOpenPathRef.current = await window.markStratum.takePendingOpenPath()
      }
      const filePath = startupOpenPathRef.current
      if (!active || !filePath) {
        return
      }
      startupOpenPathRef.current = null
      await openPath(filePath)
    })()
    return () => {
      active = false
    }
  }, [openPath])

  const zoomPercent = useMemo(
    () => Math.round((focusedTab?.scale ?? 1) * 100),
    [focusedTab?.scale],
  )

  const secondaryTabId =
    layout?.mode === 'split'
      ? layout.panes[focusedPane === 0 ? 1 : 0]
      : null

  const paneWidth = useMemo(() => {
    if (layout?.mode === 'split') {
      return Math.max(320, Math.floor(viewportSize.width * layout.sizes[focusedPane] - 8))
    }
    return viewportSize.width
  }, [focusedPane, layout, viewportSize.width])

  const renderPane = (tab: TabState | undefined, width: number) => {
    if (!tab) {
      return (
        <PdfViewport
          document={null}
          viewMode="document"
          scale={1}
          pageIndex={0}
          onPageIndexChange={() => undefined}
          onScaleChange={() => undefined}
          onOpenFilePath={(filePath) => {
            void openPath(filePath)
          }}
          onRenderError={setError}
          renderPageToUrl={renderPageToUrl}
          viewportWidth={width}
        />
      )
    }
    return (
      <PdfViewport
        key={tab.id}
        document={tab.document}
        viewMode={tab.viewMode}
        scale={tab.scale}
        pageIndex={tab.pageIndex}
        onPageIndexChange={(pageIndex) => updateTab(tab.id, { pageIndex })}
        onScaleChange={(scale) => updateTab(tab.id, { scale: clampScale(scale) })}
        onOpenFilePath={(filePath) => {
          void openPath(filePath)
        }}
        onRenderError={setError}
        renderPageToUrl={renderPageToUrl}
        viewportWidth={width}
        formFields={tab.formFields}
        formRevision={tab.formRevision}
        layersRevision={tab.layersRevision}
        pagesRevision={tab.pagesRevision}
        onFormValuesChange={(updates) => {
          void setFormValuesForDocument(tab.document.documentId, updates)
        }}
        activeMarkupTool={activeMarkupTool}
        markupStyle={markupStyle}
        markupAuthor={markupAuthor}
        markups={
          tab.document.documentId === focusedTab?.document.documentId ? markups : []
        }
        selectedMarkupId={
          tab.document.documentId === focusedTab?.document.documentId
            ? selectedMarkupId
            : null
        }
        hiddenLayerIds={
          tab.document.documentId === focusedTab?.document.documentId
            ? hiddenLayerIds
            : undefined
        }
        onSelectMarkup={
          tab.document.documentId === focusedTab?.document.documentId
            ? setSelectedMarkupId
            : undefined
        }
        onCreateMarkup={
          tab.document.documentId === focusedTab?.document.documentId
            ? (input) =>
                createMarkup({
                  ...input,
                  layerId: activeLayerId ?? undefined,
                })
            : undefined
        }
        onPatchMarkupPoints={
          tab.document.documentId === focusedTab?.document.documentId
            ? patchLocalPoints
            : undefined
        }
        onCommitMarkupPoints={
          tab.document.documentId === focusedTab?.document.documentId
            ? (markupId, points) => updateMarkup({ id: markupId, points }, { points })
            : undefined
        }
      />
    )
  }

  const leftTab =
    layout?.mode === 'split'
      ? tabs.find((tab) => tab.id === layout.panes[0])
      : focusedTab ?? undefined
  const rightTab =
    layout?.mode === 'split'
      ? tabs.find((tab) => tab.id === layout.panes[1])
      : undefined

  return (
    <div className="app">
      <div className="app-body">
        <ToolShelf
          recentEntries={recentEntries}
          onOpenRecent={(filePath) => {
            void openPath(filePath)
          }}
          onClearRecent={clearRecent}
          documentId={focusedTab?.document.documentId ?? null}
          pages={focusedTab?.document.pages ?? []}
          pageIndex={focusedTab?.pageIndex ?? 0}
          pagesRevision={focusedTab?.pagesRevision ?? 0}
          layersRevision={focusedTab?.layersRevision ?? 0}
          bookmarksRevision={focusedTab?.bookmarksRevision ?? 0}
          renderPageToUrl={renderPageToUrl}
          onGoToBookmarkPage={(pageIndex) => {
            if (!focusedTabId || !focusedTab) {
              return
            }
            const maxIndex = Math.max(0, focusedTab.document.pageCount - 1)
            const nextIndex = Math.min(maxIndex, Math.max(0, pageIndex))
            updateTab(focusedTabId, { pageIndex: nextIndex })
          }}
          onPagesChanged={(result, kind) => {
            void applyPagesChanged(result, kind)
          }}
          onOpenFilePath={(filePath) => {
            void openPath(filePath)
          }}
          onLayersChanged={(result) => {
            applyLayersChanged(result)
            setLayers(result.layers)
          }}
          onBookmarksChanged={applyBookmarksChanged}
          activeMarkupTool={activeMarkupTool}
          markupStyle={markupStyle}
          layers={layers}
          activeLayerId={activeLayerId}
          selectedMarkup={selectedMarkup}
          onActiveMarkupToolChange={setActiveMarkupTool}
          onMarkupStyleChange={setMarkupStyle}
          onMarkupAuthorChange={setMarkupAuthor}
          onActiveLayerChange={setActiveLayerId}
          onSelectedMarkupStyleChange={(patch) => {
            if (!selectedMarkup) {
              return
            }
            const stylePatch: Parameters<typeof updateMarkup>[0]['style'] = {}
            const optimistic: Partial<MarkupInfo> = {}
            if (patch.color) {
              const color = hexToRgb01(patch.color)
              stylePatch.color = color
              optimistic.color = color
            }
            if (patch.strokeWidth !== undefined) {
              stylePatch.strokeWidth = patch.strokeWidth
              optimistic.strokeWidth = patch.strokeWidth
            }
            if (patch.hatch !== undefined) {
              stylePatch.hatch = patch.hatch
              optimistic.hatch = patch.hatch
            }
            if (patch.hatchScale !== undefined) {
              stylePatch.hatchScale = patch.hatchScale
              optimistic.hatchScale = patch.hatchScale
            }
            if (patch.hatchColor) {
              const hatchColor = hexToRgb01(patch.hatchColor)
              stylePatch.hatchColor = hatchColor
              optimistic.hatchColor = hatchColor
            }
            if (patch.contents !== undefined) {
              optimistic.contents = patch.contents
            }
            if (patch.layerId !== undefined) {
              optimistic.layerId = patch.layerId || undefined
            }
            updateMarkup(
              {
                id: selectedMarkup.id,
                style: stylePatch,
                contents: patch.contents,
                layerId: patch.layerId,
              },
              optimistic,
            )
          }}
          onError={setError}
        />

        <div className="app-main">
          {error ? <div className="error-banner">{error}</div> : null}

          <TabBar
            tabs={tabs}
            activeTabId={focusedTabId}
            secondaryTabId={secondaryTabId}
            onActivate={activateTabInFocusedPane}
            onClose={(tabId) => {
              void closeTab(tabId)
            }}
            onReorder={reorderTabs}
          />

          {layout?.mode === 'split' ? (
            <SplitWorkspace
              left={renderPane(leftTab, Math.max(320, Math.floor(viewportSize.width * layout.sizes[0] - 8)))}
              right={renderPane(rightTab, Math.max(320, Math.floor(viewportSize.width * layout.sizes[1] - 8)))}
              sizes={layout.sizes}
              focusedPane={focusedPane}
              onFocusPane={setFocusedPane}
              onSizesChange={setSplitSizes}
            />
          ) : (
            renderPane(focusedTab ?? undefined, paneWidth)
          )}
        </div>
      </div>

      <Toolbar
        hasDocument={Boolean(focusedTab)}
        viewMode={(focusedTab?.viewMode ?? 'document') as ViewMode}
        zoomPercent={zoomPercent}
        pageIndex={focusedTab?.pageIndex ?? 0}
        pageCount={focusedTab?.document.pageCount ?? 0}
        splitActive={layout?.mode === 'split'}
        canSplit={tabs.length >= 2}
        onViewModeChange={(mode) => {
          if (focusedTabId) {
            updateTab(focusedTabId, { viewMode: mode })
          }
        }}
        onToggleSplit={toggleSplit}
        onZoomIn={() => {
          if (focusedTab) {
            updateTab(focusedTab.id, { scale: clampScale(focusedTab.scale * ZOOM_STEP) })
          }
        }}
        onZoomOut={() => {
          if (focusedTab) {
            updateTab(focusedTab.id, { scale: clampScale(focusedTab.scale / ZOOM_STEP) })
          }
        }}
        onFit={applyFit}
        onPageChange={(pageIndex) => {
          if (focusedTabId) {
            updateTab(focusedTabId, { pageIndex })
          }
        }}
      />

      <MarkupListPanel
        documentId={focusedTab?.document.documentId ?? null}
        markups={markups}
        selectedMarkupId={selectedMarkupId}
        onSelectMarkup={setSelectedMarkupId}
        onDeleteMarkup={(markupId) => {
          deleteMarkup(markupId)
          if (selectedMarkupId === markupId) {
            setSelectedMarkupId(null)
          }
        }}
        onGoToPage={(pageIndex) => {
          if (!focusedTabId || !focusedTab) {
            return
          }
          const maxIndex = Math.max(0, focusedTab.document.pageCount - 1)
          const nextIndex = Math.min(maxIndex, Math.max(0, pageIndex))
          updateTab(focusedTabId, { pageIndex: nextIndex })
        }}
      />

      <StatusBar
        viewMode={focusedTab?.viewMode ?? 'document'}
        pageIndex={focusedTab?.pageIndex ?? 0}
        pageCount={focusedTab?.document.pageCount ?? 0}
        zoomPercent={zoomPercent}
        busy={busy}
      />

      {passwordPromptPath ? (
        <PasswordDialog
          filePath={passwordPromptPath}
          onSubmit={(password) => {
            void submitPassword(password)
          }}
          onCancel={() => setPasswordPromptPath(null)}
        />
      ) : null}
    </div>
  )
}

function clampScale(scale: number): number {
  return Math.min(8, Math.max(0.1, scale))
}
