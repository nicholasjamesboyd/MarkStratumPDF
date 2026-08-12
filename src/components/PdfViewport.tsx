import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { DocumentInfo, FormFieldInfo, FormValueUpdate, ViewMode } from '../../shared/ipc'
import { FormFieldOverlays } from './FormFieldOverlays'

const PAGE_GAP = 12
const PREFETCH_BEHIND = 2
const PREFETCH_AHEAD = 5
const RENDER_CONCURRENCY = 4

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
    documentId: string
    pageIndex: number
    scale: number
    requestId: string
  }) => Promise<{ url: string; width: number; height: number; scale: number }>
  viewportWidth: number
  formFields?: FormFieldInfo[]
  formRevision?: number
  layersRevision?: number
  onFormValuesChange?: (updates: FormValueUpdate[]) => void
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
  formFields = [],
  formRevision = 0,
  layersRevision = 0,
  onFormValuesChange,
}: PdfViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef<HTMLDivElement>(null)
  const [images, setImages] = useState<Record<number, PageImage>>({})
  const [visiblePages, setVisiblePages] = useState<number[]>([0])
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [panning, setPanning] = useState(false)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const ignoreScrollSync = useRef(false)
  const syncingPageFromScroll = useRef(false)
  const prevPageIndexForJump = useRef(pageIndex)
  const lastScrollTop = useRef(0)
  const scrollDirection = useRef(1)
  const imagesRef = useRef(images)
  const documentPath = document?.path ?? null
  const renderGen = useRef(0)

  imagesRef.current = images

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

  useEffect(() => {
    setImages({})
    setVisiblePages([0])
    setPan({ x: 40, y: 40 })
    lastScrollTop.current = 0
    scrollDirection.current = 1
    prevPageIndexForJump.current = -1
    syncingPageFromScroll.current = false
    renderGen.current += 1
  }, [documentPath])

  useEffect(() => {
    if (formRevision <= 0 && layersRevision <= 0) {
      return
    }
    setImages({})
    renderGen.current += 1
  }, [formRevision, layersRevision])

  useEffect(() => {
    renderGen.current += 1
  }, [scale])

  useEffect(() => {
    if (!document || !documentPath) {
      return
    }

    const generation = renderGen.current
    const center = visiblePages[0] ?? pageIndex
    const behind = scrollDirection.current < 0 ? PREFETCH_AHEAD : PREFETCH_BEHIND
    const ahead = scrollDirection.current < 0 ? PREFETCH_BEHIND : PREFETCH_AHEAD
    const targets = prioritizePages(
      expandAround(visiblePages, document.pageCount, behind, ahead),
      center,
    ).filter((index) => {
      const existing = imagesRef.current[index]
      return !existing || Math.abs(existing.scale - scale) >= 0.001
    })

    if (targets.length === 0) {
      return
    }

    let cancelled = false

    void runPool(targets, RENDER_CONCURRENCY, async (index) => {
      if (cancelled || generation !== renderGen.current) {
        return
      }
      const existing = imagesRef.current[index]
      if (existing && Math.abs(existing.scale - scale) < 0.001) {
        return
      }
      try {
        const rendered = await renderPageToUrl({
          documentId: document.documentId,
          pageIndex: index,
          scale,
          requestId: `${generation}-${index}-${scale}`,
        })
        // Apply finished work even if this effect was superseded by a scroll
        // update, as long as the document scale generation is still current.
        if (generation !== renderGen.current) {
          return
        }
        setImages((prev) => {
          const current = prev[index]
          if (current && Math.abs(current.scale - rendered.scale) < 0.001) {
            return prev
          }
          return {
            ...prev,
            [index]: rendered,
          }
        })
      } catch (error) {
        if (generation === renderGen.current) {
          const message = error instanceof Error ? error.message : String(error)
          onRenderError(`Could not render page ${index + 1}: ${message}`)
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [document, documentPath, onRenderError, pageIndex, renderPageToUrl, scale, visiblePages])

  useEffect(() => {
    const pageChanged = prevPageIndexForJump.current !== pageIndex
    prevPageIndexForJump.current = pageIndex

    // Scroll-driven page updates must not re-anchor the viewport to page top.
    if (syncingPageFromScroll.current) {
      syncingPageFromScroll.current = false
      return
    }

    if (!pageChanged || viewMode !== 'document' || !scrollRef.current || !pageLayouts[pageIndex]) {
      return
    }

    ignoreScrollSync.current = true
    const top = Math.max(0, pageLayouts[pageIndex].y - 16)
    scrollRef.current.scrollTo({ top, behavior: 'auto' })
    lastScrollTop.current = top
    const timer = window.setTimeout(() => {
      ignoreScrollSync.current = false
    }, 120)
    return () => window.clearTimeout(timer)
  }, [pageIndex, pageLayouts, viewMode])

  useEffect(() => {
    if (viewMode !== 'drawing') {
      return
    }
    setVisiblePages(expandAround([pageIndex], document?.pageCount ?? 0, PREFETCH_BEHIND, PREFETCH_AHEAD))
  }, [document?.pageCount, pageIndex, viewMode])

  const onDocumentScroll = () => {
    const el = scrollRef.current
    if (!el || !document || ignoreScrollSync.current) {
      return
    }
    const top = el.scrollTop
    const delta = top - lastScrollTop.current
    if (Math.abs(delta) > 1) {
      scrollDirection.current = delta > 0 ? 1 : -1
    }
    lastScrollTop.current = top

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
    setVisiblePages((prev) => (sameNumberList(prev, nextVisible) ? prev : nextVisible))
    if (current !== pageIndex) {
      syncingPageFromScroll.current = true
      onPageIndexChange(current)
    }
  }

  const onDragOver = (event: DragEvent) => {
    event.preventDefault()
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (!file?.name.toLowerCase().endsWith('.pdf')) {
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
    const target = event.target as HTMLElement | null
    if (target?.closest('.form-field-control, .form-field-layer label')) {
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
    setPan({
      x: panStart.current.panX + (event.clientX - panStart.current.x),
      y: panStart.current.panY + (event.clientY - panStart.current.y),
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
    const nextScale = clampScale(scale * (event.deltaY > 0 ? 0.9 : 1.1))
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
          <img
            className="brand-logo"
            src="./markstratum-logo.png"
            alt="MarkStratum"
            width={360}
            height={196}
          />
          <p>
            Drag a PDF onto this window, or choose File → Open.
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
              width: Math.max(viewportWidth, ...pageLayouts.map((page) => page.width), 1),
              height: Math.max(totalHeight, 1),
            }}
          >
            <div className="drawing-pages">
              {pageLayouts.map((layout) => {
                const page = document.pages[layout.index]
                return (
                  <PageSlot
                    key={layout.index}
                    width={layout.width}
                    height={layout.height}
                    label={`Page ${layout.index + 1}`}
                    image={imageForScale(images[layout.index], scale)}
                    formFields={formFields}
                    pageIndex={layout.index}
                    pageHeightPts={page?.height ?? layout.height / scale}
                    scale={scale}
                    onFormValuesChange={onFormValuesChange}
                  />
                )
              })}
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
          {pageLayouts.map((layout) => {
            const page = document.pages[layout.index]
            return (
              <PageSlot
                key={layout.index}
                width={layout.width}
                height={layout.height}
                label={`Page ${layout.index + 1}`}
                image={imageForScale(images[layout.index], scale)}
                formFields={formFields}
                pageIndex={layout.index}
                pageHeightPts={page?.height ?? layout.height / scale}
                scale={scale}
                onFormValuesChange={onFormValuesChange}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function imageForScale(image: PageImage | undefined, scale: number): PageImage | undefined {
  if (!image || Math.abs(image.scale - scale) >= 0.001) {
    return undefined
  }
  return image
}

function PageSlot({
  width,
  height,
  label,
  image,
  formFields = [],
  pageIndex = 0,
  pageHeightPts = 0,
  scale = 1,
  onFormValuesChange,
}: {
  width: number
  height: number
  label: string
  image?: PageImage
  formFields?: FormFieldInfo[]
  pageIndex?: number
  pageHeightPts?: number
  scale?: number
  onFormValuesChange?: (updates: FormValueUpdate[]) => void
}) {
  return (
    <div className="page-slot" style={{ width, height }}>
      {image ? (
        <img src={image.url} alt={label} width={width} height={height} decoding="async" />
      ) : (
        <div className="page-placeholder">{label}</div>
      )}
      {onFormValuesChange ? (
        <FormFieldOverlays
          fields={formFields}
          pageIndex={pageIndex}
          pageHeightPts={pageHeightPts}
          scale={scale}
          onValuesChange={onFormValuesChange}
        />
      ) : null}
    </div>
  )
}

function expandAround(
  indices: number[],
  pageCount: number,
  behind = PREFETCH_BEHIND,
  ahead = PREFETCH_AHEAD,
): number[] {
  if (pageCount <= 0) {
    return []
  }
  const set = new Set<number>()
  for (const index of indices) {
    for (let offset = -behind; offset <= ahead; offset += 1) {
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

function prioritizePages(indices: number[], center: number): number[] {
  return [...indices].sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const run = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex
      nextIndex += 1
      await worker(items[current])
    }
  }
  const size = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: size }, () => run()))
}

function sameNumberList(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((value, index) => value === b[index])
}

function clampScale(scale: number): number {
  return Math.min(8, Math.max(0.1, scale))
}
