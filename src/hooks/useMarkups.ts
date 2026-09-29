import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DocumentInfo,
  MarkupCreateRequest,
  MarkupInfo,
  MarkupPoint,
  MarkupTool,
  MarkupUpdateRequest,
} from '../../shared/ipc'
import { authorOrUnknown, hexToRgb01, type MarkupDrawStyle } from '../markup/markupState'

type PersistResult = {
  document: DocumentInfo
  markups: MarkupInfo[]
  markupsRevision: number
  pagesRevision?: number
}

type UseMarkupsOptions = {
  documentId: string | null
  markupsRevision: number
  onPersisted: (result: PersistResult) => void
  onError: (message: string) => void
}

let tempIdCounter = 0

function nextTempId(): string {
  tempIdCounter += 1
  return `temp-${Date.now()}-${tempIdCounter}`
}

function boundsFromPoints(points: MarkupPoint[], strokeWidth: number) {
  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  for (const point of points) {
    left = Math.min(left, point.x)
    right = Math.max(right, point.x)
    bottom = Math.min(bottom, point.y)
    top = Math.max(top, point.y)
  }
  if (!Number.isFinite(left)) {
    left = 0
    right = 0
    bottom = 0
    top = 0
  }
  const pad = Math.max(2, strokeWidth)
  return {
    left: left - pad,
    bottom: bottom - pad,
    right: right + pad,
    top: top + pad,
  }
}

export function useMarkups({
  documentId,
  markupsRevision,
  onPersisted,
  onError,
}: UseMarkupsOptions) {
  const [markups, setMarkups] = useState<MarkupInfo[]>([])
  const markupsRef = useRef(markups)
  markupsRef.current = markups

  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const documentIdRef = useRef(documentId)
  documentIdRef.current = documentId
  const onPersistedRef = useRef(onPersisted)
  onPersistedRef.current = onPersisted
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const loadMarkups = useCallback(async (id: string) => {
    try {
      const next = await window.markStratum.getMarkups(id)
      if (documentIdRef.current !== id) {
        return
      }
      setMarkups((prev) => {
        const pending = prev.filter((item) => item.id.startsWith('temp-'))
        if (pending.length === 0) {
          return next
        }
        const confirmedIds = new Set(next.map((item) => item.id))
        const stillPending = pending.filter((item) => !confirmedIds.has(item.id))
        return [...next, ...stillPending]
      })
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    if (!documentId) {
      setMarkups([])
      return
    }
    void loadMarkups(documentId)
  }, [documentId, loadMarkups, markupsRevision])

  const enqueue = useCallback((task: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(task, task)
  }, [])

  const createMarkup = useCallback(
    (input: {
      pageIndex: number
      tool: MarkupTool
      author: string
      style: MarkupDrawStyle
      points: MarkupPoint[]
      contents?: string
      layerId?: string
    }) => {
      const id = documentIdRef.current
      if (!id) {
        return
      }

      const color = hexToRgb01(input.style.color)
      const hatchColor = hexToRgb01(input.style.hatchColor || input.style.color)
      const strokeWidth = input.style.strokeWidth
      const tempId = nextTempId()
      const optimistic: MarkupInfo = {
        id: tempId,
        pageIndex: input.pageIndex,
        tool: input.tool,
        author: authorOrUnknown(input.author),
        contents: input.contents,
        bounds: boundsFromPoints(input.points, strokeWidth),
        hatch: input.style.hatch,
        hatchScale: input.style.hatchScale,
        hatchColor,
        color,
        strokeWidth,
        points: input.points,
        layerId: input.layerId,
      }

      setMarkups((prev) => [...prev, optimistic])

      const request: MarkupCreateRequest = {
        pageIndex: input.pageIndex,
        tool: input.tool,
        author: authorOrUnknown(input.author),
        points: input.points,
        layerId: input.layerId,
        style: {
          color,
          strokeWidth,
          hatch: input.style.hatch,
          hatchScale: input.style.hatchScale,
          hatchColor,
          opacity: input.tool === 'highlighter' ? 0.4 : 1,
          contents: input.contents,
        },
      }

      enqueue(async () => {
        if (documentIdRef.current !== id) {
          return
        }
        try {
          const result = await window.markStratum.createMarkup(id, request)
          if (!result.ok) {
            setMarkups((prev) => prev.filter((item) => item.id !== tempId))
            onErrorRef.current(result.error)
            return
          }
          setMarkups((prev) => {
            const otherTemps = prev.filter(
              (item) => item.id.startsWith('temp-') && item.id !== tempId,
            )
            return [...result.markups, ...otherTemps]
          })
          onPersistedRef.current({
            document: result.document,
            markups: result.markups,
            markupsRevision: result.markupsRevision,
            pagesRevision: result.pagesRevision,
          })
        } catch (error) {
          setMarkups((prev) => prev.filter((item) => item.id !== tempId))
          onErrorRef.current(error instanceof Error ? error.message : String(error))
        }
      })
    },
    [enqueue],
  )

  const updateMarkup = useCallback(
    (request: MarkupUpdateRequest, optimisticPatch?: Partial<MarkupInfo>) => {
      const id = documentIdRef.current
      if (!id || request.id.startsWith('temp-')) {
        return
      }

      if (optimisticPatch) {
        setMarkups((prev) =>
          prev.map((item) =>
            item.id === request.id
              ? {
                  ...item,
                  ...optimisticPatch,
                  bounds:
                    optimisticPatch.points
                      ? boundsFromPoints(
                          optimisticPatch.points,
                          optimisticPatch.strokeWidth ?? item.strokeWidth,
                        )
                      : item.bounds,
                }
              : item,
          ),
        )
      }

      enqueue(async () => {
        if (documentIdRef.current !== id) {
          return
        }
        try {
          const result = await window.markStratum.updateMarkup(id, request)
          if (!result.ok) {
            void loadMarkups(id)
            onErrorRef.current(result.error)
            return
          }
          setMarkups((prev) => {
            const temps = prev.filter((item) => item.id.startsWith('temp-'))
            return [...result.markups, ...temps]
          })
          onPersistedRef.current({
            document: result.document,
            markups: result.markups,
            markupsRevision: result.markupsRevision,
            pagesRevision: result.pagesRevision,
          })
        } catch (error) {
          void loadMarkups(id)
          onErrorRef.current(error instanceof Error ? error.message : String(error))
        }
      })
    },
    [enqueue, loadMarkups],
  )

  const deleteMarkup = useCallback(
    (markupId: string) => {
      const id = documentIdRef.current
      if (!id) {
        return
      }

      const previous = markupsRef.current
      const removed = previous.find((item) => item.id === markupId)
      if (!removed) {
        return
      }

      setMarkups((prev) => prev.filter((item) => item.id !== markupId))

      if (markupId.startsWith('temp-')) {
        return
      }

      enqueue(async () => {
        if (documentIdRef.current !== id) {
          return
        }
        try {
          const result = await window.markStratum.deleteMarkup(id, markupId)
          if (!result.ok) {
            setMarkups((prev) => {
              if (prev.some((item) => item.id === markupId)) {
                return prev
              }
              return [...prev, removed]
            })
            onErrorRef.current(result.error)
            return
          }
          setMarkups(result.markups)
          onPersistedRef.current({
            document: result.document,
            markups: result.markups,
            markupsRevision: result.markupsRevision,
            pagesRevision: result.pagesRevision,
          })
        } catch (error) {
          setMarkups((prev) => {
            if (prev.some((item) => item.id === markupId)) {
              return prev
            }
            return [...prev, removed]
          })
          onErrorRef.current(error instanceof Error ? error.message : String(error))
        }
      })
    },
    [enqueue],
  )

  const flattenMarkups = useCallback(async () => {
    const id = documentIdRef.current
    if (!id) {
      return false
    }
    try {
      const result = await window.markStratum.flattenMarkups(id)
      if (!result.ok) {
        onErrorRef.current(result.error)
        return false
      }
      setMarkups(result.markups)
      onPersistedRef.current({
        document: result.document,
        markups: result.markups,
        markupsRevision: result.markupsRevision,
        pagesRevision: result.pagesRevision,
      })
      return true
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [])

  const patchLocalPoints = useCallback((markupId: string, points: MarkupPoint[]) => {
    setMarkups((prev) =>
      prev.map((item) =>
        item.id === markupId
          ? {
              ...item,
              points,
              bounds: boundsFromPoints(points, item.strokeWidth),
            }
          : item,
      ),
    )
  }, [])

  return {
    markups,
    createMarkup,
    updateMarkup,
    deleteMarkup,
    flattenMarkups,
    patchLocalPoints,
  }
}
