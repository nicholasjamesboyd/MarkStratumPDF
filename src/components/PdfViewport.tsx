import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { DocumentInfo, ViewMode } from '../../shared/ipc'

const PAGE_GAP = 12

type PdfViewportProps = {
  document: DocumentInfo | null
  viewMode: ViewMode
  scale: number
  pageIndex: number
  onPageIndexChange: (pageIndex: number) => void
  onScaleChange: (scale: number) => void
  onOpenFilePath: (filePath: string) => void
  onRenderError: (message: string) => void
  renderPageToUrl: (req: {
    pageIndex: number
    scale: number
    requestId: string
  }) => Promise<{ url: string; width: number; height: number; scale: number }>
  viewportWidth: number
}

type PageImage = {
  url: string
  width: number
  height: number
  scale: number
}

export function PdfViewport({
  document,
  viewMode,
  scale,
  pageIndex,
  onPageIndexChange,
  onScaleChange,
  onOpenFilePath,
  onRenderError,
  renderPageToUrl,
  viewportWidth,
}: PdfViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef<HTMLDivElement>(null)
  const [images, setImages] = useState<Record<number, PageImage>>({})
  const imagesRef = useRef(images)
  const [visiblePages, setVisiblePages] = useState<number[]>([0])
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [panning, setPanning] = useState(false)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const requestSerial = useRef(0)
  const ignoreScrollSync = useRef(false)
  const documentPath = document?.path ?? null

  useEffect(() => {
    imagesRef.current = images
  }, [images])

  const pageLayouts = useMemo(() => {
    if (!document) {
      return []
    }
    let y = 0
    return document.pages.map((page) => {
      const width = Math.max(1, page.width * scale)
      const height = Math.max(1, page.height * scale)
      const layout = { index: page.index, width, height, y }
      y += height + PAGE_GAP
      return layout
    })
  }, [document, scale])

  const totalHeight = pageLayouts.length
    ? pageLayouts[pageLayouts.length - 1].y + pageLayouts[pageLayouts.length - 1].height
    : 0

  const requestPages = useCallback(
    async (indices: number[], pathAtRequest: string | null) => {
      if (!document || !pathAtRequest || document.path !== pathAtRequest) {
        return
      }
      const unique = [...new Set(indices)].filter(
        (index) => index >= 0 && index < document.pageCount,
      )
      await Promise.all(
        unique.map(async (index) => {
          const existing = imagesRef.current[index]
          if (existing && Math.abs(existing.scale - scale) < 0.001) {
            return
          }
          const requestId = `${++requestSerial.current}`
          try {
            const rendered = await renderPageToUrl({
              pageIndex: index,
              scale,
              requestId,
            })
            if (documentPath !== pathAtRequest) {
              return
            }
            setImages((prev) => ({
              ...prev,
              [index]: rendered,
            }))
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            onRenderError(`Could not render page ${index + 1}: ${message}`)
          }
        }),
      )
    },
    [document, documentPath, onRenderError, renderPageToUrl, scale],
  )

  useEffect(() => {
    setImages({})
    imagesRef.current = {}
    setVisiblePages([0])
    setPan({ x: 40, y: 40 })
  }, [documentPath])

  useEffect(() => {
    if (!documentPath) {
      return
    }
    void requestPages(expandAround(visiblePages, document?.pageCount ?? 0), documentPath)
  }, [document?.pageCount, documentPath, requestPages, scale, visiblePages])

  useEffect(() => {
    if (viewMode !== 'document' || !scrollRef.current || !pageLayouts[pageIndex]) {
      return
    }
    ignoreScrollSync.current = true
    scrollRef.current.scrollTo({
      top: Math.max(0, pageLayouts[pageIndex].y - 16),
      behavior: 'auto',
    })
    window.setTimeout(() => {
      ignoreScrollSync.current = false
    }, 50)
  }, [pageIndex, pageLayouts, viewMode])

  const onDocumentScroll = () => {
    const el = scrollRef.current
    if (!el || !document || ignoreScrollSync.current) {
      return
    }
    const top = el.scrollTop
    const bottom = top + el.clientHeight
    const nextVisible: number[] = []
    let current = 0
    for (const layout of pageLayouts) {
      const pageBottom = layout.y + layout.height
      if (pageBottom >= top && layout.y <= bottom) {
        nextVisible.push(layout.index)
      }
      if (layout.y <= top + 24) {
        current = layout.index
      }
    }
    if (nextVisible.length === 0 && pageLayouts.length) {
      nextVisible.push(Math.min(pageLayouts.length - 1, Math.max(0, current)))
    }
    setVisiblePages(nextVisible)
    if (current !== pageIndex) {
      onPageIndexChange(current)
    }
  }

  useEffect(() => {
    if (viewMode !== 'drawing') {
      return
    }
    setVisiblePages(expandAround([pageIndex], document?.pageCount ?? 0))
  }, [document?.pageCount, pageIndex, viewMode])

  const onDragOver = (event: DragEvent) => {
    event.preventDefault()
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (!file) {
      return
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return
    }
    const filePath = window.markStratum.getPathForFile(file)
    if (filePath) {
      onOpenFilePath(filePath)
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (viewMode !== 'drawing' || event.button !== 0) {
      return
    }
    setPanning(true)
    panStart.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panning || !panStart.current) {
      return
    }
    const dx = event.clientX - panStart.current.x
    const dy = event.clientY - panStart.current.y
    setPan({
      x: panStart.current.panX + dx,
      y: panStart.current.panY + dy,
    })
  }

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panning) {
      return
    }
    setPanning(false)
    panStart.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (viewMode !== 'drawing') {
      return
    }
    event.preventDefault()
    const rect = drawingRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    const cursorX = event.clientX - rect.left
    const cursorY = event.clientY - rect.top
    const delta = event.deltaY > 0 ? 0.9 : 1.1
    const nextScale = clampScale(scale * delta)
    const ratio = nextScale / scale
    setPan({
      x: cursorX - (cursorX - pan.x) * ratio,
      y: cursorY - (cursorY - pan.y) * ratio,
    })
    onScaleChange(nextScale)
  }

  if (!document) {
    return (
      <div className="viewport-shell" onDragOver={onDragOver} onDrop={onDrop}>
        <div className="empty-state">
          <h1>Open a PDF to begin</h1>
          <p>
            Use Open, drag a PDF onto this window, or choose File → Open.
            Switch to Drawing mode for pan and zoom on large sheets.
          </p>
        </div>
      </div>
    )
  }

  if (viewMode === 'drawing') {
    return (
      <div className="viewport-shell" onDragOver={onDragOver} onDrop={onDrop}>
        <div
          ref={drawingRef}
          className={`drawing-viewport${panning ? ' panning' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={onWheel}
        >
          <div
            className="drawing-stage"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              width: Math.max(
                viewportWidth,
                ...pageLayouts.map((page) => page.width),
                1,
              ),
              height: Math.max(totalHeight, 1),
            }}
          >
            <div className="drawing-pages">
              {pageLayouts.map((layout) => (
                <PageSlot
                  key={layout.index}
                  width={layout.width}
                  height={layout.height}
                  label={`Page ${layout.index + 1}`}
                  image={images[layout.index]}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const stageWidth = Math.max(
    Math.min(viewportWidth - 32, 800),
    ...pageLayouts.map((page) => page.width),
    1,
  )

  return (
    <div className="viewport-shell" onDragOver={onDragOver} onDrop={onDrop}>
      <div ref={scrollRef} className="document-viewport" onScroll={onDocumentScroll}>
        <div className="document-stage" style={{ width: stageWidth + 32 }}>
          {pageLayouts.map((layout) => (
            <PageSlot
              key={layout.index}
              width={layout.width}
              height={layout.height}
              label={`Page ${layout.index + 1}`}
              image={images[layout.index]}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PageSlot({
  width,
  height,
  label,
  image,
}: {
  width: number
  height: number
  label: string
  image?: PageImage
}) {
  return (
    <div className="page-slot" style={{ width, height }}>
      {image ? (
        <img src={image.url} alt={label} width={width} height={height} />
      ) : (
        <div className="page-placeholder">{label}</div>
      )}
    </div>
  )
}

function expandAround(indices: number[], pageCount: number): number[] {
  if (pageCount <= 0) {
    return []
  }
  const set = new Set<number>()
  for (const index of indices) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const next = index + offset
      if (next >= 0 && next < pageCount) {
        set.add(next)
      }
    }
  }
  if (set.size === 0) {
    set.add(0)
  }
  return [...set]
}

function clampScale(scale: number): number {
  return Math.min(8, Math.max(0.1, scale))
}
