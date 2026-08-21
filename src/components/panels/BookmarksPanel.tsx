import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import {
  BookmarkDragMime,
  type BookmarkMutationResult,
  type BookmarkNode,
  type DocumentInfo,
} from '../../../shared/ipc'

type DropPosition = 'before' | 'after' | 'into'

type BookmarksPanelProps = {
  documentId: string | null
  pageIndex: number
  bookmarksRevision?: number
  onBookmarksChanged: (result: {
    document: DocumentInfo
    bookmarks: BookmarkNode[]
    bookmarksRevision: number
  }) => void
  onGoToPage: (pageIndex: number) => void
  onError: (message: string) => void
}

type BookmarkRowProps = {
  node: BookmarkNode
  depth: number
  busy: boolean
  renamingId: string | null
  renameValue: string
  dragId: string | null
  dropTargetId: string | null
  dropPosition: DropPosition | null
  onGoToPage: (pageIndex: number) => void
  onStartRename: (node: BookmarkNode) => void
  onRenameValueChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onDelete: (node: BookmarkNode) => void
  onDragStart: (event: DragEvent, node: BookmarkNode) => void
  onDragOverRow: (event: DragEvent, node: BookmarkNode) => void
  onDropOnRow: (event: DragEvent, node: BookmarkNode) => void
  onDragEnd: () => void
}

function BookmarkRow({
  node,
  depth,
  busy,
  renamingId,
  renameValue,
  dragId,
  dropTargetId,
  dropPosition,
  onGoToPage,
  onStartRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
  onDragStart,
  onDragOverRow,
  onDropOnRow,
  onDragEnd,
}: BookmarkRowProps) {
  const children = node.children ?? []
  const hasChildren = children.length > 0
  const [expanded, setExpanded] = useState(node.open || depth < 1)
  const canNavigate = typeof node.pageIndex === 'number'
  const isRenaming = renamingId === node.id
  const isDragging = dragId === node.id
  const isDropTarget = dropTargetId === node.id

  useEffect(() => {
    if (hasChildren && node.open) {
      setExpanded(true)
    }
  }, [hasChildren, node.open])

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommitRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancelRename()
    }
  }

  return (
    <li className="bookmark-node">
      <div
        className={[
          'bookmark-row',
          isDragging ? 'dragging' : '',
          isDropTarget && dropPosition === 'before' ? 'drop-before' : '',
          isDropTarget && dropPosition === 'after' ? 'drop-after' : '',
          isDropTarget && dropPosition === 'into' ? 'drop-into' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `${0.55 + depth * 0.75}rem` }}
        draggable={!busy && !isRenaming}
        onDragStart={(event) => onDragStart(event, node)}
        onDragOver={(event) => onDragOverRow(event, node)}
        onDrop={(event) => onDropOnRow(event, node)}
        onDragEnd={onDragEnd}
      >
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

        {isRenaming ? (
          <input
            className="bookmark-rename-input"
            value={renameValue}
            autoFocus
            disabled={busy}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={onRenameKeyDown}
            aria-label="Bookmark name"
          />
        ) : (
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
            onDoubleClick={() => onStartRename(node)}
          >
            <span className="bookmark-title">{node.title || 'Untitled'}</span>
            {canNavigate ? (
              <span className="bookmark-page">{node.pageIndex! + 1}</span>
            ) : null}
          </button>
        )}

        <div className="bookmark-actions">
          <button
            type="button"
            className="bookmark-action"
            title="Rename"
            disabled={busy || isRenaming}
            onClick={() => onStartRename(node)}
          >
            Rename
          </button>
          <button
            type="button"
            className="bookmark-action bookmark-action-danger"
            title="Delete"
            disabled={busy}
            onClick={() => onDelete(node)}
          >
            Delete
          </button>
        </div>
      </div>

      {hasChildren && expanded ? (
        <ul className="bookmark-children">
          {children.map((child) => (
            <BookmarkRow
              key={child.id}
              node={child}
              depth={depth + 1}
              busy={busy}
              renamingId={renamingId}
              renameValue={renameValue}
              dragId={dragId}
              dropTargetId={dropTargetId}
              dropPosition={dropPosition}
              onGoToPage={onGoToPage}
              onStartRename={onStartRename}
              onRenameValueChange={onRenameValueChange}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragOverRow={onDragOverRow}
              onDropOnRow={onDropOnRow}
              onDragEnd={onDragEnd}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function BookmarksPanel({
  documentId,
  pageIndex,
  bookmarksRevision = 0,
  onBookmarksChanged,
  onGoToPage,
  onError,
}: BookmarksPanelProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkNode[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)

  const loadBookmarks = useCallback(async () => {
    if (!documentId) {
      setBookmarks([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const next = await window.markStratum.getBookmarks(documentId)
      setBookmarks(next)
    } catch (err) {
      setBookmarks([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    void loadBookmarks()
  }, [loadBookmarks, bookmarksRevision])

  const applyMutation = useCallback(
    async (run: () => Promise<BookmarkMutationResult>) => {
      if (!documentId) {
        return
      }
      setBusy(true)
      setError(null)
      try {
        const result = await run()
        if (!result.ok) {
          setError(result.error)
          onError(result.error)
          return
        }
        setBookmarks(result.bookmarks)
        onBookmarksChanged({
          document: result.document,
          bookmarks: result.bookmarks,
          bookmarksRevision: result.bookmarksRevision,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        onError(message)
      } finally {
        setBusy(false)
      }
    },
    [documentId, onBookmarksChanged, onError],
  )

  const onCreate = () => {
    if (!documentId) {
      return
    }
    const title = newTitle.trim() || `Page ${pageIndex + 1}`
    setNewTitle('')
    void applyMutation(() =>
      window.markStratum.createBookmark(documentId, pageIndex, title),
    )
  }

  const onStartRename = (node: BookmarkNode) => {
    setRenamingId(node.id)
    setRenameValue(node.title)
  }

  const onCancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const onCommitRename = () => {
    if (!documentId || !renamingId) {
      return
    }
    const bookmarkId = renamingId
    const nextTitle = renameValue.trim()
    const current = findBookmark(bookmarks, bookmarkId)
    setRenamingId(null)
    setRenameValue('')
    if (!current || !nextTitle || nextTitle === current.title) {
      return
    }
    void applyMutation(() =>
      window.markStratum.renameBookmark(documentId, bookmarkId, nextTitle),
    )
  }

  const onDelete = (node: BookmarkNode) => {
    if (!documentId) {
      return
    }
    const confirmed = window.confirm(
      `Delete bookmark "${node.title || 'Untitled'}"${
        node.children?.length ? ' and its nested bookmarks' : ''
      }?`,
    )
    if (!confirmed) {
      return
    }
    void applyMutation(() => window.markStratum.deleteBookmark(documentId, node.id))
  }

  const clearDropState = () => {
    setDragId(null)
    setDropTargetId(null)
    setDropPosition(null)
  }

  const onDragStart = (event: DragEvent, node: BookmarkNode) => {
    event.dataTransfer.setData(BookmarkDragMime, node.id)
    event.dataTransfer.effectAllowed = 'move'
    setDragId(node.id)
  }

  const onDragOverRow = (event: DragEvent, node: BookmarkNode) => {
    if (!dragId || dragId === node.id) {
      return
    }
    if (!Array.from(event.dataTransfer.types).includes(BookmarkDragMime)) {
      return
    }
    if (isDescendantId(bookmarks, dragId, node.id)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1)
    let nextPosition: DropPosition
    if (ratio < 0.25) {
      nextPosition = 'before'
    } else if (ratio > 0.75) {
      nextPosition = 'after'
    } else {
      nextPosition = 'into'
    }

    setDropTargetId(node.id)
    setDropPosition(nextPosition)
  }

  const onDropOnRow = (event: DragEvent, node: BookmarkNode) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData(BookmarkDragMime) || dragId
    const position = dropTargetId === node.id ? dropPosition : null
    clearDropState()

    if (!documentId || !sourceId || !position || sourceId === node.id) {
      return
    }
    if (isDescendantId(bookmarks, sourceId, node.id)) {
      return
    }

    const location = resolveDropLocation(bookmarks, sourceId, node.id, position)
    if (!location) {
      return
    }

    void applyMutation(() =>
      window.markStratum.moveBookmark(
        documentId,
        sourceId,
        location.parentId,
        location.index,
      ),
    )
  }

  const onDragOverRoot = (event: DragEvent) => {
    if (!dragId || !Array.from(event.dataTransfer.types).includes(BookmarkDragMime)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetId('__root__')
    setDropPosition('after')
  }

  const onDropOnRoot = (event: DragEvent) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData(BookmarkDragMime) || dragId
    clearDropState()
    if (!documentId || !sourceId) {
      return
    }
    void applyMutation(() =>
      window.markStratum.moveBookmark(documentId, sourceId, null, bookmarks.length),
    )
  }

  if (!documentId) {
    return <p className="panel-empty">Open a PDF to view its bookmarks.</p>
  }

  if (loading && bookmarks.length === 0) {
    return <p className="panel-empty">Loading bookmarks…</p>
  }

  return (
    <div className="bookmarks-panel">
      <div className="bookmarks-toolbar">
        <input
          className="bookmarks-new-input"
          value={newTitle}
          placeholder={`Page ${pageIndex + 1}`}
          disabled={busy}
          onChange={(event) => setNewTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onCreate()
            }
          }}
        />
        <button type="button" className="bookmarks-new-button" disabled={busy} onClick={onCreate}>
          Add
        </button>
      </div>

      {error ? <p className="panel-empty">{error}</p> : null}

      {!error && bookmarks.length === 0 ? (
        <p className="panel-empty">No bookmarks yet. Add one for the current page.</p>
      ) : (
        <ul className="bookmark-tree">
          {bookmarks.map((node) => (
            <BookmarkRow
              key={node.id}
              node={node}
              depth={0}
              busy={busy}
              renamingId={renamingId}
              renameValue={renameValue}
              dragId={dragId}
              dropTargetId={dropTargetId}
              dropPosition={dropPosition}
              onGoToPage={onGoToPage}
              onStartRename={onStartRename}
              onRenameValueChange={setRenameValue}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragOverRow={onDragOverRow}
              onDropOnRow={onDropOnRow}
              onDragEnd={clearDropState}
            />
          ))}
        </ul>
      )}

      {bookmarks.length > 0 ? (
        <div
          className={`bookmark-drop-end${
            dropTargetId === '__root__' ? ' drop-before' : ''
          }`}
          onDragOver={onDragOverRoot}
          onDrop={onDropOnRoot}
        />
      ) : null}
    </div>
  )
}

function findBookmark(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const nested = findBookmark(node.children ?? [], id)
    if (nested) {
      return nested
    }
  }
  return null
}

function isDescendantId(
  nodes: BookmarkNode[],
  ancestorId: string,
  candidateId: string,
): boolean {
  const ancestor = findBookmark(nodes, ancestorId)
  if (!ancestor) {
    return false
  }
  return Boolean(findBookmark(ancestor.children ?? [], candidateId))
}

function findParentAndIndex(
  nodes: BookmarkNode[],
  id: string,
  parentId: string | null = null,
): { parentId: string | null; index: number; siblings: BookmarkNode[] } | null {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) {
    return { parentId, index, siblings: nodes }
  }
  for (const node of nodes) {
    const children = node.children ?? []
    if (children.length === 0) {
      continue
    }
    const found = findParentAndIndex(children, id, node.id)
    if (found) {
      return found
    }
  }
  return null
}

function resolveDropLocation(
  nodes: BookmarkNode[],
  sourceId: string,
  targetId: string,
  position: DropPosition,
): { parentId: string | null; index: number } | null {
  if (position === 'into') {
    const target = findBookmark(nodes, targetId)
    if (!target) {
      return null
    }
    return { parentId: targetId, index: target.children?.length ?? 0 }
  }

  const targetLocation = findParentAndIndex(nodes, targetId)
  if (!targetLocation) {
    return null
  }

  let index = position === 'before' ? targetLocation.index : targetLocation.index + 1
  const sourceLocation = findParentAndIndex(nodes, sourceId)
  if (
    sourceLocation &&
    sourceLocation.parentId === targetLocation.parentId &&
    sourceLocation.index < index
  ) {
    index -= 1
  }

  return { parentId: targetLocation.parentId, index }
}
