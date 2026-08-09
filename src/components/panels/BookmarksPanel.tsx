import { useEffect, useState } from 'react'
import type { BookmarkNode } from '../../../shared/ipc'

type BookmarksPanelProps = {
  documentId: string | null
  onGoToPage: (pageIndex: number) => void
}

type BookmarkRowProps = {
  node: BookmarkNode
  path: string
  depth: number
  onGoToPage: (pageIndex: number) => void
}

function BookmarkRow({ node, path, depth, onGoToPage }: BookmarkRowProps) {
  const children = node.children ?? []
  const hasChildren = children.length > 0
  const [expanded, setExpanded] = useState(node.open || depth < 1)
  const canNavigate = typeof node.pageIndex === 'number'

  return (
    <li className="bookmark-node">
      <div className="bookmark-row" style={{ paddingLeft: `${0.55 + depth * 0.75}rem` }}>
        {hasChildren ? (
          <button
            type="button"
            className="bookmark-toggle"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="bookmark-toggle-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className={`bookmark-item${canNavigate ? '' : ' bookmark-item-static'}`}
          title={
            canNavigate
              ? `Go to page ${node.pageIndex! + 1}`
              : node.url
                ? node.url
                : node.title
          }
          disabled={!canNavigate}
          onClick={() => {
            if (canNavigate) {
              onGoToPage(node.pageIndex!)
            }
          }}
        >
          <span className="bookmark-title">{node.title || 'Untitled'}</span>
          {canNavigate ? (
            <span className="bookmark-page">{node.pageIndex! + 1}</span>
          ) : null}
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul className="bookmark-children">
          {children.map((child, index) => (
            <BookmarkRow
              key={`${path}-${index}`}
              node={child}
              path={`${path}-${index}`}
              depth={depth + 1}
              onGoToPage={onGoToPage}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function BookmarksPanel({ documentId, onGoToPage }: BookmarksPanelProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkNode[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId) {
      setBookmarks([])
      setError(null)
      setBusy(false)
      return
    }

    let cancelled = false
    setBusy(true)
    setError(null)

    void window.markStratum
      .getBookmarks(documentId)
      .then((nodes) => {
        if (!cancelled) {
          setBookmarks(nodes)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setBookmarks([])
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [documentId])

  if (!documentId) {
    return <p className="panel-empty">Open a PDF to view its bookmarks.</p>
  }

  if (busy) {
    return <p className="panel-empty">Loading bookmarks…</p>
  }

  if (error) {
    return <p className="panel-empty">{error}</p>
  }

  if (bookmarks.length === 0) {
    return <p className="panel-empty">This PDF has no bookmarks.</p>
  }

  return (
    <ul className="bookmark-tree">
      {bookmarks.map((node, index) => (
        <BookmarkRow
          key={`root-${index}`}
          node={node}
          path={`root-${index}`}
          depth={0}
          onGoToPage={onGoToPage}
        />
      ))}
    </ul>
  )
}
