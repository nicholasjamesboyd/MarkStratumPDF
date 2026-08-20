import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { displayPageSize, type PageCropRect, type PageInfo } from '../../../shared/ipc'

const INCH_PRESETS = [0.25, 0.5, 1] as const
const POINTS_PER_INCH = 72

type RenderPageToUrl = (req: {
  documentId: string
  pageIndex: number
  scale: number
  rotation?: 0 | 1 | 2 | 3
  requestId: string
}) => Promise<{ url: string; width: number; height: number; scale: number }>

type PageCropDialogProps = {
  documentId: string
  page: PageInfo
  pagesRevision: number
  selectedCount: number
  renderPageToUrl: RenderPageToUrl
  onApply: (crop: PageCropRect) => void
  onClose: () => void
}

type DragMode =
  | { kind: 'move'; startX: number; startY: number; startCrop: PageCropRect }
  | { kind: 'resize'; handle: string; startX: number; startY: number; startCrop: PageCropRect }

const FULL_CROP: PageCropRect = { left: 0, bottom: 0, width: 1, height: 1 }

export function PageCropDialog({
  documentId,
  page,
  pagesRevision,
  selectedCount,
  renderPageToUrl,
  onApply,
  onClose,
}: PageCropDialogProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<PageCropRect>(FULL_CROP)
  const [dragMode, setDragMode] = useState<DragMode | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { width, height } = displayPageSize(page)
        const scale = Math.min(1.5, 480 / Math.max(width, height))
        const rendered = await renderPageToUrl({
          documentId,
          pageIndex: page.index,
          scale,
          requestId: `crop-${documentId}:${page.index}:${pagesRevision}`,
        })
        if (!cancelled) {
          setImageUrl(rendered.url)
        }
      } catch {
        if (!cancelled) {
          setImageUrl(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId, page.index, page.height, page.rotation, page.width, pagesRevision, renderPageToUrl])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return
    }
    event.preventDefault()
    setDragMode({
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startCrop: crop,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragMode({
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startCrop: crop,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onHandlePointerDown = (handle: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragMode({
      kind: 'resize',
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: crop,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!dragMode || !stageRef.current) {
        return
      }
      const rect = stageRef.current.getBoundingClientRect()
      const dx = (event.clientX - dragMode.startX) / rect.width
      const dy = (event.clientY - dragMode.startY) / rect.height
      const start = dragMode.startCrop

      if (dragMode.kind === 'move') {
        const left = clamp(start.left + dx, 0, 1 - start.width)
        const bottom = clamp(start.bottom - dy, 0, 1 - start.height)
        setCrop({ ...start, left, bottom })
        return
      }

      const next = { ...start }
      if (dragMode.handle.includes('w')) {
        const left = clamp(start.left + dx, 0, start.left + start.width - 0.05)
        next.width = start.width + (start.left - left)
        next.left = left
      }
      if (dragMode.handle.includes('e')) {
        next.width = clamp(start.width + dx, 0.05, 1 - start.left)
      }
      if (dragMode.handle.includes('s')) {
        const bottom = clamp(start.bottom - dy, 0, start.bottom + start.height - 0.05)
        next.height = start.height + (start.bottom - bottom)
        next.bottom = bottom
      }
      if (dragMode.handle.includes('n')) {
        next.height = clamp(start.height + dy, 0.05, 1 - start.bottom)
      }
      setCrop(next)
    },
    [dragMode],
  )

  const onPointerUp = () => {
    setDragMode(null)
  }

  const applyMarginPreset = (inches: number) => {
    const marginW = (inches * POINTS_PER_INCH) / Math.max(page.width, 1)
    const marginH = (inches * POINTS_PER_INCH) / Math.max(page.height, 1)
    setCrop({
      left: clamp(marginW, 0, 0.45),
      bottom: clamp(marginH, 0, 0.45),
      width: clamp(1 - marginW * 2, 0.1, 1),
      height: clamp(1 - marginH * 2, 0.1, 1),
    })
  }

  const cropStyle = {
    left: `${crop.left * 100}%`,
    bottom: `${crop.bottom * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  }

  return (
    <div className="page-crop-backdrop" role="presentation" onClick={onClose}>
      <div
        className="page-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-crop-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="page-crop-header">
          <h3 id="page-crop-title">Crop page</h3>
          <button type="button" className="page-crop-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div
          ref={stageRef}
          className="page-crop-stage"
          onPointerDown={onStagePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {imageUrl ? (
            <img src={imageUrl} alt="" className="page-crop-image" draggable={false} />
          ) : (
            <div className="page-crop-loading">Loading preview…</div>
          )}
          <div className="page-crop-overlay" />
          <div
            className="page-crop-box"
            style={cropStyle}
            onPointerDown={onCropPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
              <button
                key={handle}
                type="button"
                className={`page-crop-handle page-crop-handle-${handle}`}
                aria-label={`Resize ${handle}`}
                onPointerDown={onHandlePointerDown(handle)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            ))}
          </div>
        </div>

        <div className="page-crop-presets">
          {INCH_PRESETS.map((inches) => (
            <button key={inches} type="button" onClick={() => applyMarginPreset(inches)}>
              Trim {inches} in
            </button>
          ))}
          <button type="button" onClick={() => setCrop(FULL_CROP)}>
            Reset
          </button>
        </div>

        <footer className="page-crop-footer">
          <span className="page-crop-scope">
            {selectedCount > 1
              ? `Apply to ${selectedCount} selected pages`
              : 'Apply to selected page'}
          </span>
          <div className="page-crop-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => onApply(crop)}>
              Apply crop
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
