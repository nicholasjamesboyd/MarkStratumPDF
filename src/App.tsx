import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FitMode, ViewMode } from '../shared/ipc'
import { PasswordDialog } from './components/PasswordDialog'
import { PdfViewport } from './components/PdfViewport'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { useDocumentSession } from './hooks/useDocumentSession'

const ZOOM_STEP = 1.15

export default function App() {
  const {
    document,
    busy,
    error,
    setError,
    passwordPromptPath,
    setPasswordPromptPath,
    openPath,
    openDialog,
    submitPassword,
    renderPageToUrl,
  } = useDocumentSession()

  const [viewMode, setViewMode] = useState<ViewMode>('document')
  const [scale, setScale] = useState(1)
  const [pageIndex, setPageIndex] = useState(0)
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 })

  const currentPage = document?.pages[pageIndex]

  const applyFit = useCallback(
    (mode: FitMode) => {
      if (!currentPage) {
        if (mode === 'custom') {
          setScale(1)
        }
        return
      }
      if (mode === 'custom') {
        setScale(1)
        return
      }
      const availableWidth = Math.max(200, viewportSize.width - 48)
      const availableHeight = Math.max(200, viewportSize.height - 24)
      if (mode === 'width') {
        setScale(clampScale(availableWidth / currentPage.width))
        return
      }
      const widthScale = availableWidth / currentPage.width
      const heightScale = availableHeight / currentPage.height
      setScale(clampScale(Math.min(widthScale, heightScale)))
    },
    [currentPage, viewportSize.height, viewportSize.width],
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
    setPageIndex(0)
    setScale(1)
  }, [document?.path])

  useEffect(() => {
    const offOpen = window.markStratum.onMenuOpen(() => {
      void openDialog()
    })
    const offMode = window.markStratum.onMenuSetViewMode((mode) => {
      setViewMode(mode)
    })
    const offZoom = window.markStratum.onMenuZoom((command) => {
      if (command === 'in') {
        setScale((value) => clampScale(value * ZOOM_STEP))
      } else if (command === 'out') {
        setScale((value) => clampScale(value / ZOOM_STEP))
      } else if (command === 'actual') {
        setScale(1)
      } else if (command === 'fitWidth') {
        applyFit('width')
      } else if (command === 'fitPage') {
        applyFit('page')
      }
    })
    const offPath = window.markStratum.onOpenPath((filePath) => {
      void openPath(filePath)
    })
    return () => {
      offOpen()
      offMode()
      offZoom()
      offPath()
    }
  }, [applyFit, openDialog, openPath])

  const zoomPercent = useMemo(() => Math.round(scale * 100), [scale])

  return (
    <div className="app">
      <Toolbar
        fileName={document?.fileName ?? null}
        viewMode={viewMode}
        zoomPercent={zoomPercent}
        pageIndex={pageIndex}
        pageCount={document?.pageCount ?? 0}
        busy={busy}
        onOpen={() => {
          void openDialog()
        }}
        onViewModeChange={setViewMode}
        onZoomIn={() => setScale((value) => clampScale(value * ZOOM_STEP))}
        onZoomOut={() => setScale((value) => clampScale(value / ZOOM_STEP))}
        onFit={applyFit}
        onPageChange={setPageIndex}
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <PdfViewport
        document={document}
        viewMode={viewMode}
        scale={scale}
        pageIndex={pageIndex}
        onPageIndexChange={setPageIndex}
        onScaleChange={(next) => setScale(clampScale(next))}
        onOpenFilePath={(filePath) => {
          void openPath(filePath)
        }}
        onRenderError={setError}
        renderPageToUrl={renderPageToUrl}
        viewportWidth={viewportSize.width}
      />

      <StatusBar
        viewMode={viewMode}
        pageIndex={pageIndex}
        pageCount={document?.pageCount ?? 0}
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
