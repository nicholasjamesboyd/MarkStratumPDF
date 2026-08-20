import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  PageDragMime,
  TabDragMime,
  displayPageSize,
  type DocumentInfo,
  type PageCropRect,
  type PageInfo,
  type PageMutationResult,
} from '../../../shared/ipc'
import { PageCropDialog } from './PageCropDialog'
import { PagesPanelToolbar } from './PagesPanelToolbar'

const PREFETCH = 2
const THUMB_MAX_WIDTH = 120
const THUMB_MAX_HEIGHT = 112

export type PagesChangedKind =
  | { type: 'reorder'; fromIndex: number; toIndex: number }
  | { type: 'insert'; insertAt: number }
  | { type: 'insertBlank'; insertAt: number }
  | { type: 'delete'; deletedIndices: number[] }
  | { type: 'rotate'; pageIndices: number[] }
  | { type: 'split'; splitAt: number; removedCount: number }
  | { type: 'replace'; targetIndices: number[] }
  | { type: 'crop'; pageIndices: number[] }

type RenderPageToUrl = (req: {
  documentId: string
  pageIndex: number
  scale: number
  rotation?: 0 | 1 | 2 | 3
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
  onOpenFilePath: (filePath: string) => void
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
  onOpenFilePath,
  onError,
}: PagesPanelProps) {
  const [images, setImages] = useState<Record<number, string>>({})
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4, 5]))
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set())
  const [selectionAnchor, setSelectionAnchor] = useState(0)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overInsertIndex, setOverInsertIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const requestedRef = useRef<Set<number>>(new Set())
  const suppressClickRef = useRef(false)

  const sortedSelection = useMemo(
    () => [...selectedIndices].sort((a, b) => a - b),
    [selectedIndices],
  )

  useEffect(() => {
    setImages({})
    requestedRef.current = new Set()
    setVisiblePages(new Set([0, 1, 2, 3, 4, 5]))
    setDragIndex(null)
    setOverInsertIndex(null)
    setSelectedIndices(new Set())
    setSelectionAnchor(0)
    setCropOpen(false)
  }, [documentId])

  useEffect(() => {
    setImages({})
    requestedRef.current = new Set()
    setDragIndex(null)
    setOverInsertIndex(null)
    setCropOpen(false)
    setSelectedIndices((prev) => {
      const next = new Set<number>()
      for (const index of prev) {
        if (index < pages.length) {
          next.add(index)
        }
      }
      if (next.size === 0 && pages.length > 0) {
        next.add(Math.min(pageIndex, pages.length - 1))
      }
      return next
    })
  }, [pageIndex, pages.length, pagesRevision])

  useEffect(() => {
    if (!documentId) {
      return
    }
    setSelectedIndices((prev) => {
      if (prev.size === 0) {
        return new Set([pageIndex])
      }
      return prev
    })
  }, [documentId, pageIndex])

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

  const runMutation = async (
    action: () => Promise<PageMutationResult>,
    kind: PagesChangedKind,
  ) => {
    if (!documentId || busy) {
      return
    }
    setBusy(true)
    try {
      const result = await action()
      await applyResult(result, kind)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const insertAt = sortedSelection.length > 0 ? Math.max(...sortedSelection) + 1 : pages.length

  const handleInsertBlank = () => {
    if (!documentId) {
      return
    }
    void runMutation(
      () => window.markStratum.insertBlankPage(documentId, insertAt),
      { type: 'insertBlank', insertAt },
    )
  }

  const handleInsertFromFile = async () => {
    if (!documentId) {
      return
    }
    const picked = await window.markStratum.pickPdfPath()
    if (!picked?.ok) {
      return
    }
    void runMutation(
      () => window.markStratum.insertPagesFromPath(documentId, picked.path, insertAt),
      { type: 'insert', insertAt },
    )
  }

  const handleExtract = async () => {
    if (!documentId || sortedSelection.length === 0) {
      return
    }
    setBusy(true)
    try {
      const result = await window.markStratum.extractPages(documentId, sortedSelection)
      if (!result) {
        return
      }
      if (!result.ok) {
        onError(result.error)
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = () => {
    if (!documentId || sortedSelection.length === 0) {
      return
    }
    if (sortedSelection.length >= pages.length) {
      onError('Keep at least one page.')
      return
    }
    if (
      sortedSelection.length >= 3 &&
      !window.confirm(`Delete ${sortedSelection.length} pages?`)
    ) {
      return
    }
    void runMutation(
      () => window.markStratum.deletePages(documentId, sortedSelection),
      { type: 'delete', deletedIndices: sortedSelection },
    )
  }

  const handleSplit = async () => {
    if (!documentId || sortedSelection.length === 0) {
      return
    }
    const splitAt = Math.min(...sortedSelection)
    if (splitAt <= 0 || splitAt >= pages.length) {
      onError('Choose a split point after the first page and before the end.')
      return
    }
    setBusy(true)
    try {
      const result = await window.markStratum.splitDocumentAtPage(documentId, splitAt)
      if (!result) {
        return
      }
      if (!result.ok) {
        onError(result.error)
        return
      }
      const removedCount = pages.length - result.document.pageCount
      onPagesChanged(result, { type: 'split', splitAt, removedCount })
      if (result.savedPath) {
        onOpenFilePath(result.savedPath)
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleRotate = (quarterTurns: 1 | 3) => {
    if (!documentId || sortedSelection.length === 0) {
      return
    }
    void runMutation(
      () => window.markStratum.rotatePages(documentId, sortedSelection, quarterTurns),
      { type: 'rotate', pageIndices: sortedSelection },
    )
  }

  const handleReplaceFromFile = async () => {
    if (!documentId || sortedSelection.length === 0) {
      return
    }
    const picked = await window.markStratum.pickPdfPath()
    if (!picked?.ok) {
      return
    }
    void runMutation(
      () =>
        window.markStratum.replacePagesFromPath(
          documentId,
          sortedSelection,
          picked.path,
          0,
        ),
      { type: 'replace', targetIndices: sortedSelection },
    )
  }

  const handleCropApply = (crop: PageCropRect) => {
    if (!documentId || sortedSelection.length === 0) {
      return
    }
    setCropOpen(false)
    void runMutation(
      () => window.markStratum.cropPages(documentId, sortedSelection, crop),
      { type: 'crop', pageIndices: sortedSelection },
    )
  }

  const onItemClick = (index: number, event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    if (event.shiftKey) {
      const start = Math.min(selectionAnchor, index)
      const end = Math.max(selectionAnchor, index)
      const range = new Set<number>()
      for (let i = start; i <= end; i += 1) {
        range.add(i)
      }
      setSelectedIndices(range)
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedIndices((prev) => {
        const next = new Set(prev)
        if (next.has(index)) {
          next.delete(index)
        } else {
          next.add(index)
        }
        if (next.size === 0) {
          next.add(index)
        }
        return next
      })
      setSelectionAnchor(index)
    } else {
      setSelectedIndices(new Set([index]))
      setSelectionAnchor(index)
    }
    onGoToPage(index)
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
    if (selectedIndices.has(index) && sortedSelection.length > 0 && !event.dataTransfer.types.includes(PageDragMime)) {
      setOverInsertIndex(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const insertBefore = event.clientX < rect.left + rect.width / 2 ? index : index + 1
    if (overInsertIndex !== insertBefore) {
      setOverInsertIndex(insertBefore)
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

  const isReplaceDrop = (index: number, event: DragEvent) => {
    const types = Array.from(event.dataTransfer.types)
    if (types.includes(PageDragMime)) {
      return false
    }
    return selectedIndices.has(index) && sortedSelection.length > 0
  }

  const onDropAt = async (event: DragEvent, insertBefore: number) => {
    event.preventDefault()
    event.stopPropagation()
    clearDrag()
    if (!documentId || busy) {
      return
    }

    if (isReplaceDrop(insertBefore, event)) {
      const tabRaw = event.dataTransfer.getData(TabDragMime)
      if (tabRaw) {
        const payload = parseJson<TabDragPayload>(tabRaw)
        if (!payload?.documentId || payload.documentId === documentId) {
          return
        }
        setBusy(true)
        try {
          const result = await window.markStratum.replacePagesFromDocument(
            documentId,
            sortedSelection,
            payload.documentId,
            0,
          )
          await applyResult(result, { type: 'replace', targetIndices: sortedSelection })
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
        const file = files[0]!
        const filePath = window.markStratum.getPathForFile(file)
        const targetCount = sortedSelection.length
        const result = await window.markStratum.replacePagesFromPath(
          documentId,
          sortedSelection,
          filePath,
          0,
        )
        const applied = await applyResult(result, { type: 'replace', targetIndices: sortedSelection })
        if (applied && targetCount > 1) {
          // warn handled by backend if mismatch
        }
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
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
      let nextInsertAt = insertBefore
      let pageCountLocal = pages.length
      for (const file of files) {
        const filePath = window.markStratum.getPathForFile(file)
        const result = await window.markStratum.insertPagesFromPath(documentId, filePath, nextInsertAt)
        const applied = await applyResult(result, { type: 'insert', insertAt: nextInsertAt })
        if (!applied || !result.ok) {
          return
        }
        const insertedCount = result.document.pageCount - pageCountLocal
        nextInsertAt += insertedCount
        pageCountLocal = result.document.pageCount
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const cropPage = sortedSelection.length > 0 ? pages[sortedSelection[0]!] : null

  if (!documentId) {
    return <p className="panel-empty">Open a PDF to preview its pages.</p>
  }

  if (pages.length === 0) {
    return <p className="panel-empty">This PDF has no pages.</p>
  }

  return (
    <div className={`pages-panel-shell${busy ? ' busy' : ''}`}>
      <PagesPanelToolbar
        hasSelection={sortedSelection.length > 0}
        pageCount={pages.length}
        selectedCount={sortedSelection.length}
        minSelectedIndex={sortedSelection.length > 0 ? sortedSelection[0]! : 0}
        busy={busy}
        onInsertBlank={handleInsertBlank}
        onInsertFromFile={() => {
          void handleInsertFromFile()
        }}
        onExtract={() => {
          void handleExtract()
        }}
        onDelete={handleDelete}
        onSplit={() => {
          void handleSplit()
        }}
        onRotateLeft={() => handleRotate(3)}
        onRotateRight={() => handleRotate(1)}
        onReplaceFromFile={() => {
          void handleReplaceFromFile()
        }}
        onCrop={() => setCropOpen(true)}
      />

      <div
        className={`pages-panel${busy ? ' busy' : ''}`}
        onDragOver={(event) => {
          acceptDrop(event)
        }}
      >
        {pages.map((page, index) => {
          const isCurrent = index === pageIndex
          const isSelected = selectedIndices.has(index)
          const isDragging = dragIndex === index
          const isNoOpInsert = (insertBefore: number) =>
            dragIndex !== null && (insertBefore === dragIndex || insertBefore === dragIndex + 1)
          const dropBefore =
            overInsertIndex === index && dragIndex !== null && !isNoOpInsert(index)
          const dropAfter =
            overInsertIndex === index + 1 && dragIndex !== null && !isNoOpInsert(index + 1)
          const className = [
            'pages-item',
            isCurrent ? 'current' : '',
            isSelected ? 'selected' : '',
            isDragging ? 'dragging' : '',
            dropBefore ? 'drop-before' : '',
            dropAfter ? 'drop-after' : '',
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
              title={`Page ${index + 1}`}
              draggable={!busy}
              disabled={busy}
              onDragStart={(event) => onItemDragStart(event, index)}
              onDragOver={(event) => onItemDragOver(event, index)}
              onDrop={(event) => {
                void onDropAt(event, index)
              }}
              onDragEnd={clearDrag}
              onClick={(event) => onItemClick(index, event)}
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

      {cropOpen && cropPage ? (
        <PageCropDialog
          documentId={documentId}
          page={cropPage}
          pagesRevision={pagesRevision}
          selectedCount={sortedSelection.length}
          renderPageToUrl={renderPageToUrl}
          onApply={handleCropApply}
          onClose={() => setCropOpen(false)}
        />
      ) : null}
    </div>
  )
}

function thumbScale(page: PageInfo): number {
  const { width, height } = displayPageSize(page)
  const widthScale = THUMB_MAX_WIDTH / Math.max(width, 1)
  const heightScale = THUMB_MAX_HEIGHT / Math.max(height, 1)
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
