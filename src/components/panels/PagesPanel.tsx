import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  PageDragMime,
  TabDragMime,
  type DocumentInfo,
  type PageInfo,
  type PageMutationResult,
} from '../../../shared/ipc'

const PREFETCH = 2
const THUMB_MAX_WIDTH = 200
const THUMB_MAX_HEIGHT = 192

export type PagesChangedKind =
  | { type: 'reorder'; fromIndex: number; toIndex: number }
  | { type: 'insert'; insertAt: number }

type RenderPageToUrl = (req: {
  documentId: string
  pageIndex: number
  scale: number
  requestId: string
}) => Promise<{ url: string; width: number; height: number; scale: number }>

type PagesPanelProps = {
  documentId: string | null
  pages: PageInfo[]
  pageIndex: number
  pagesRevision: number
  renderPageToUrl: RenderPageToUrl
  onGoToPage: (pageIndex: number) => void
  onPagesChanged: (result: { document: DocumentInfo; pagesRevision: number }, kind: PagesChangedKind) => void
  onError: (message: string) => void
}

type PageDragPayload = {
  documentId: string
  pageIndex: number
}

type TabDragPayload = {
  documentId: string
}

export function PagesPanel({
  documentId,
  pages,
  pageIndex,
  pagesRevision,
  renderPageToUrl,
  onGoToPage,
  onPagesChanged,
  onError,
}: PagesPanelProps) {
  const [images, setImages] = useState<Record<number, string>>({})
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4, 5]))
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overInsertIndex, setOverInsertIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const requestedRef = useRef<Set<number>>(new Set())
  const suppressClickRef = useRef(false)

  useEffect(() => {
    setImages({})
    requestedRef.current = new Set()
    setVisiblePages(new Set([0, 1, 2, 3, 4, 5]))
    setDragIndex(null)
    setOverInsertIndex(null)
  }, [documentId, pagesRevision])

  const neededPages = useMemo(() => {
    const needed = new Set<number>()
    for (const index of visiblePages) {
      for (let offset = -PREFETCH; offset <= PREFETCH; offset += 1) {
        const next = index + offset
        if (next >= 0 && next < pages.length) {
          needed.add(next)
        }
      }
    }
    return [...needed].sort((a, b) => a - b)
  }, [pages.length, visiblePages])

  useEffect(() => {
    if (!documentId || neededPages.length === 0) {
      return
    }

    let cancelled = false
    void (async () => {
      for (const index of neededPages) {
        if (cancelled) {
          return
        }
        if (requestedRef.current.has(index)) {
          continue
        }
        const page = pages[index]
        if (!page) {
          continue
        }
        requestedRef.current.add(index)
        try {
          const rendered = await renderPageToUrl({
            documentId,
            pageIndex: index,
            scale: thumbScale(page),
            requestId: `pages-thumb-${documentId}:${index}:${pagesRevision}`,
          })
          if (cancelled) {
            return
          }
          setImages((prev) => ({ ...prev, [index]: rendered.url }))
        } catch {
          requestedRef.current.delete(index)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [documentId, neededPages, pages, pagesRevision, renderPageToUrl])

  useEffect(() => {
    observerRef.current?.disconnect()
    const first = itemRefs.current.get(0)
    const root =
      first?.closest('.tool-shelf-panel-body') instanceof HTMLElement
        ? first.closest('.tool-shelf-panel-body')
        : null
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev)
          for (const entry of entries) {
            const raw = (entry.target as HTMLElement).dataset.pageIndex
            const index = raw ? Number(raw) : Number.NaN
            if (!Number.isFinite(index)) {
              continue
            }
            if (entry.isIntersecting) {
              next.add(index)
            } else {
              next.delete(index)
            }
          }
          if (next.size === prev.size) {
            let unchanged = true
            for (const value of next) {
              if (!prev.has(value)) {
                unchanged = false
                break
              }
            }
            if (unchanged) {
              return prev
            }
          }
          return next
        })
      },
      { root, rootMargin: '120px 0px', threshold: 0.01 },
    )
    observerRef.current = observer
    for (const element of itemRefs.current.values()) {
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [pages.length, documentId])

  const setItemRef = (index: number, element: HTMLButtonElement | null) => {
    const previous = itemRefs.current.get(index)
    if (previous && previous !== element) {
      observerRef.current?.unobserve(previous)
      itemRefs.current.delete(index)
    }
    if (element) {
      itemRefs.current.set(index, element)
      observerRef.current?.observe(element)
    }
  }

  const clearDrag = () => {
    setDragIndex(null)
    setOverInsertIndex(null)
  }

  const onItemDragStart = (event: DragEvent<HTMLButtonElement>, index: number) => {
    if (!documentId || busy) {
      event.preventDefault()
      return
    }
    suppressClickRef.current = false
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(
      PageDragMime,
      JSON.stringify({ documentId, pageIndex: index } satisfies PageDragPayload),
    )
  }

  const acceptDrop = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer.types)
    const isPage = types.includes(PageDragMime)
    const isTab = types.includes(TabDragMime)
    const isFiles = types.includes('Files')
    if (!isPage && !isTab && !isFiles) {
      return false
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = isPage ? 'move' : 'copy'
    return true
  }

  const onItemDragOver = (event: DragEvent<HTMLButtonElement>, index: number) => {
    if (!acceptDrop(event) || busy) {
      return
    }
    if (overInsertIndex !== index) {
      setOverInsertIndex(index)
    }
  }

  const onEndDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptDrop(event) || busy) {
      return
    }
    if (overInsertIndex !== pages.length) {
      setOverInsertIndex(pages.length)
    }
  }

  const applyResult = async (
    result: PageMutationResult,
    kind: PagesChangedKind,
  ): Promise<boolean> => {
    if (!result.ok) {
      onError(result.error)
      return false
    }
    onPagesChanged(result, kind)
    return true
  }

  const onDropAt = async (event: DragEvent, insertBefore: number) => {
    event.preventDefault()
    event.stopPropagation()
    clearDrag()
    if (!documentId || busy) {
      return
    }

    const pageRaw = event.dataTransfer.getData(PageDragMime)
    if (pageRaw) {
      const payload = parseJson<PageDragPayload>(pageRaw)
      if (!payload || payload.documentId !== documentId) {
        return
      }
      const fromIndex = payload.pageIndex
      const toIndex = toIndexFromInsertBefore(fromIndex, insertBefore)
      if (toIndex === fromIndex) {
        return
      }
      suppressClickRef.current = true
      setBusy(true)
      try {
        const result = await window.markStratum.reorderPages(documentId, fromIndex, toIndex)
        await applyResult(result, { type: 'reorder', fromIndex, toIndex })
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
      return
    }

    const tabRaw = event.dataTransfer.getData(TabDragMime)
    if (tabRaw) {
      const payload = parseJson<TabDragPayload>(tabRaw)
      if (!payload?.documentId || payload.documentId === documentId) {
        return
      }
      setBusy(true)
      try {
        const result = await window.markStratum.insertPagesFromDocument(
          documentId,
          payload.documentId,
          insertBefore,
        )
        await applyResult(result, { type: 'insert', insertAt: insertBefore })
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
      return
    }

    const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.name.toLowerCase().endsWith('.pdf'),
    )
    if (files.length === 0) {
      return
    }

    setBusy(true)
    try {
      let insertAt = insertBefore
      let pageCount = pages.length
      for (const file of files) {
        const filePath = window.markStratum.getPathForFile(file)
        const result = await window.markStratum.insertPagesFromPath(documentId, filePath, insertAt)
        const applied = await applyResult(result, { type: 'insert', insertAt })
        if (!applied || !result.ok) {
          return
        }
        const insertedCount = result.document.pageCount - pageCount
        insertAt += insertedCount
        pageCount = result.document.pageCount
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (!documentId) {
    return <p className="panel-empty">Open a PDF to preview its pages.</p>
  }

  if (pages.length === 0) {
    return <p className="panel-empty">This PDF has no pages.</p>
  }

  return (
    <div
      className={`pages-panel${busy ? ' busy' : ''}`}
      onDragOver={(event) => {
        acceptDrop(event)
      }}
    >
      {pages.map((page, index) => {
        const isCurrent = index === pageIndex
        const isDragging = dragIndex === index
        const dropBefore = overInsertIndex === index && dragIndex !== index
        const className = [
          'pages-item',
          isCurrent ? 'current' : '',
          isDragging ? 'dragging' : '',
          dropBefore ? 'drop-before' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const imageUrl = images[index]

        return (
          <button
            key={`${page.index}-${index}`}
            ref={(element) => setItemRef(index, element)}
            type="button"
            className={className}
            data-page-index={index}
            title={`Go to page ${index + 1}`}
            draggable={!busy}
            disabled={busy}
            onDragStart={(event) => onItemDragStart(event, index)}
            onDragOver={(event) => onItemDragOver(event, index)}
            onDrop={(event) => {
              void onDropAt(event, index)
            }}
            onDragEnd={clearDrag}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              onGoToPage(index)
            }}
          >
            <span className="pages-thumb">
              {imageUrl ? (
                <img src={imageUrl} alt="" draggable={false} />
              ) : (
                <span className="pages-thumb-placeholder">Page {index + 1}</span>
              )}
            </span>
            <span className="pages-item-label">{index + 1}</span>
          </button>
        )
      })}
      <div
        className={`pages-drop-end${overInsertIndex === pages.length ? ' drop-before' : ''}`}
        onDragOver={onEndDragOver}
        onDrop={(event) => {
          void onDropAt(event, pages.length)
        }}
      />
    </div>
  )
}

function thumbScale(page: PageInfo): number {
  const widthScale = THUMB_MAX_WIDTH / Math.max(page.width, 1)
  const heightScale = THUMB_MAX_HEIGHT / Math.max(page.height, 1)
  return Math.max(0.05, Math.round(Math.min(widthScale, heightScale) * 100) / 100)
}

function toIndexFromInsertBefore(fromIndex: number, insertBefore: number): number {
  if (insertBefore === fromIndex || insertBefore === fromIndex + 1) {
    return fromIndex
  }
  return fromIndex < insertBefore ? insertBefore - 1 : insertBefore
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
