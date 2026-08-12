import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import type { DocumentInfo, LayerInfo, LayerMutationResult } from '../../../shared/ipc'

type LayersPanelProps = {
  documentId: string | null
  layersRevision?: number
  onLayersChanged: (result: {
    document: DocumentInfo
    layers: LayerInfo[]
    layersRevision: number
  }) => void
  onError: (message: string) => void
}

type LayerRowProps = {
  layer: LayerInfo
  busy: boolean
  renamingId: string | null
  renameValue: string
  onToggle: (layer: LayerInfo, visible: boolean) => void
  onStartRename: (layer: LayerInfo) => void
  onRenameValueChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onDelete: (layer: LayerInfo) => void
}

function LayerRow({
  layer,
  busy,
  renamingId,
  renameValue,
  onToggle,
  onStartRename,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onDelete,
}: LayerRowProps) {
  const isGroup = Boolean(layer.children?.length)
  const isRenaming = renamingId === layer.id
  const children = layer.children ?? []

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
    <li className="layer-node">
      <div className="layer-row" style={{ paddingLeft: `${0.55 + layer.depth * 0.75}rem` }}>
        {isGroup ? (
          <span className="layer-group-marker" aria-hidden="true">
            ▾
          </span>
        ) : (
          <label className="layer-check">
            <input
              type="checkbox"
              checked={layer.visible}
              disabled={busy || Boolean(layer.locked)}
              onChange={(event) => onToggle(layer, event.target.checked)}
              aria-label={`Show ${layer.name}`}
            />
          </label>
        )}

        {isRenaming && !isGroup ? (
          <input
            className="layer-rename-input"
            value={renameValue}
            autoFocus
            disabled={busy}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onBlur={() => onCommitRename()}
            onKeyDown={onRenameKeyDown}
            aria-label="Layer name"
          />
        ) : (
          <button
            type="button"
            className={`layer-name${isGroup ? ' layer-name-group' : ''}`}
            title={layer.name}
            disabled={busy || isGroup}
            onDoubleClick={() => {
              if (!isGroup) {
                onStartRename(layer)
              }
            }}
          >
            {layer.name || 'Untitled'}
          </button>
        )}

        {!isGroup ? (
          <div className="layer-actions">
            <button
              type="button"
              className="layer-action"
              title="Rename"
              disabled={busy || isRenaming}
              onClick={() => onStartRename(layer)}
            >
              Rename
            </button>
            <button
              type="button"
              className="layer-action layer-action-danger"
              title="Delete"
              disabled={busy}
              onClick={() => onDelete(layer)}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {children.length > 0 ? (
        <ul className="layer-children">
          {children.map((child) => (
            <LayerRow
              key={child.id}
              layer={child}
              busy={busy}
              renamingId={renamingId}
              renameValue={renameValue}
              onToggle={onToggle}
              onStartRename={onStartRename}
              onRenameValueChange={onRenameValueChange}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function LayersPanel({
  documentId,
  layersRevision = 0,
  onLayersChanged,
  onError,
}: LayersPanelProps) {
  const [layers, setLayers] = useState<LayerInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newLayerName, setNewLayerName] = useState('')

  const loadLayers = useCallback(async () => {
    if (!documentId) {
      setLayers([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const next = await window.markStratum.getLayers(documentId)
      setLayers(next)
    } catch (err) {
      setLayers([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    void loadLayers()
  }, [loadLayers, layersRevision])

  const applyMutation = useCallback(
    async (run: () => Promise<LayerMutationResult>) => {
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
        setLayers(result.layers)
        onLayersChanged({
          document: result.document,
          layers: result.layers,
          layersRevision: result.layersRevision,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        onError(message)
      } finally {
        setBusy(false)
      }
    },
    [documentId, onError, onLayersChanged],
  )

  const onToggle = (layer: LayerInfo, visible: boolean) => {
    if (!documentId || layer.children?.length) {
      return
    }
    void applyMutation(() =>
      window.markStratum.setLayerVisibility(documentId, layer.id, visible),
    )
  }

  const onStartRename = (layer: LayerInfo) => {
    setRenamingId(layer.id)
    setRenameValue(layer.name)
  }

  const onCancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const onCommitRename = () => {
    if (!documentId || !renamingId) {
      return
    }
    const layerId = renamingId
    const nextName = renameValue.trim()
    const current = findLayer(layers, layerId)
    setRenamingId(null)
    setRenameValue('')
    if (!current || !nextName || nextName === current.name) {
      return
    }
    void applyMutation(() => window.markStratum.renameLayer(documentId, layerId, nextName))
  }

  const onDelete = (layer: LayerInfo) => {
    if (!documentId) {
      return
    }
    const confirmed = window.confirm(
      `Delete layer "${layer.name}"? Content tied to it may stay in the PDF and become always visible.`,
    )
    if (!confirmed) {
      return
    }
    void applyMutation(() => window.markStratum.deleteLayer(documentId, layer.id))
  }

  const onCreate = () => {
    if (!documentId) {
      return
    }
    const name = newLayerName.trim() || 'Layer'
    setNewLayerName('')
    void applyMutation(() => window.markStratum.createLayer(documentId, name, true))
  }

  if (!documentId) {
    return <p className="panel-empty">Open a PDF to view its layers.</p>
  }

  if (loading && layers.length === 0) {
    return <p className="panel-empty">Loading layers…</p>
  }

  return (
    <div className="layers-panel">
      <div className="layers-toolbar">
        <input
          className="layers-new-input"
          value={newLayerName}
          placeholder="New layer name"
          disabled={busy}
          onChange={(event) => setNewLayerName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onCreate()
            }
          }}
        />
        <button type="button" className="layers-new-button" disabled={busy} onClick={onCreate}>
          Add
        </button>
      </div>

      {error ? <p className="panel-empty">{error}</p> : null}

      {!error && layers.length === 0 ? (
        <p className="panel-empty">This PDF has no layers.</p>
      ) : (
        <ul className="layer-tree">
          {layers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              busy={busy}
              renamingId={renamingId}
              renameValue={renameValue}
              onToggle={onToggle}
              onStartRename={onStartRename}
              onRenameValueChange={setRenameValue}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function findLayer(layers: LayerInfo[], id: string): LayerInfo | null {
  for (const layer of layers) {
    if (layer.id === id) {
      return layer
    }
    if (layer.children?.length) {
      const found = findLayer(layer.children, id)
      if (found) {
        return found
      }
    }
  }
  return null
}
