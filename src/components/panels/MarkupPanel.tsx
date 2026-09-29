import { useEffect, useState } from 'react'
import type { HatchPattern, LayerInfo, MarkupInfo, MarkupTool } from '../../../shared/ipc'
import {
  CLOSED_SHAPE_TOOLS,
  MARKUP_TOOLS,
  authorOrUnknown,
  readAuthorName,
  rgb01ToHex,
  writeAuthorName,
  type MarkupDrawStyle,
} from '../../markup/markupState'
import { MarkupToolIcon } from '../MarkupToolIcon'

type MarkupPanelProps = {
  documentId: string | null
  activeTool: MarkupTool | null
  style: MarkupDrawStyle
  layers: LayerInfo[]
  activeLayerId: string | null
  selectedMarkup: MarkupInfo | null
  onActiveToolChange: (tool: MarkupTool | null) => void
  onStyleChange: (style: MarkupDrawStyle) => void
  onAuthorChange: (author: string) => void
  onActiveLayerChange: (layerId: string | null) => void
  onSelectedStyleChange: (patch: {
    color?: string
    strokeWidth?: number
    hatch?: HatchPattern
    hatchScale?: number
    hatchColor?: string
    contents?: string
    layerId?: string | null
  }) => void
}

function flattenLayers(layers: LayerInfo[]): LayerInfo[] {
  const out: LayerInfo[] = []
  const walk = (nodes: LayerInfo[]) => {
    for (const node of nodes) {
      if (!node.children?.length) {
        out.push(node)
      }
      if (node.children?.length) {
        walk(node.children)
      }
    }
  }
  walk(layers)
  return out
}

export function MarkupPanel({
  documentId,
  activeTool,
  style,
  layers,
  activeLayerId,
  selectedMarkup,
  onActiveToolChange,
  onStyleChange,
  onAuthorChange,
  onActiveLayerChange,
  onSelectedStyleChange,
}: MarkupPanelProps) {
  const [author, setAuthor] = useState(readAuthorName)
  const flatLayers = flattenLayers(layers)
  const editing = Boolean(selectedMarkup)

  useEffect(() => {
    onAuthorChange(authorOrUnknown(author))
  }, [author, onAuthorChange])

  const onAuthorInput = (value: string) => {
    setAuthor(value)
    writeAuthorName(value)
  }

  const hatchEnabled = editing
    ? selectedMarkup !== null && CLOSED_SHAPE_TOOLS.has(selectedMarkup.tool)
    : activeTool !== null && CLOSED_SHAPE_TOOLS.has(activeTool)

  const textEnabled =
    editing &&
    selectedMarkup !== null &&
    (selectedMarkup.tool === 'textBox' ||
      selectedMarkup.tool === 'callout' ||
      selectedMarkup.tool === 'cloudCallout')

  const color = editing && selectedMarkup ? rgb01ToHex(selectedMarkup.color) : style.color
  const strokeWidth = editing && selectedMarkup ? selectedMarkup.strokeWidth : style.strokeWidth
  const hatch = editing && selectedMarkup ? selectedMarkup.hatch : style.hatch
  const hatchScale =
    editing && selectedMarkup ? selectedMarkup.hatchScale : style.hatchScale
  const hatchColor =
    editing && selectedMarkup
      ? rgb01ToHex(selectedMarkup.hatchColor ?? selectedMarkup.color)
      : style.hatchColor
  const contents = editing && selectedMarkup ? selectedMarkup.contents ?? '' : ''
  const layerValue =
    editing && selectedMarkup
      ? selectedMarkup.layerId ?? ''
      : activeLayerId ?? ''

  if (!documentId) {
    return <p className="panel-empty">Open a PDF to add markups.</p>
  }

  return (
    <div className="markup-panel">
      <label className="markup-author-field">
        <span className="markup-field-label">Display name</span>
        <input
          type="text"
          value={author}
          placeholder="Your name"
          onChange={(event) => onAuthorInput(event.target.value)}
          aria-label="Markup author display name"
        />
      </label>

      <div className="markup-tools" role="toolbar" aria-label="Markup tools">
        {MARKUP_TOOLS.map((tool) => {
          const selected = activeTool === tool.id
          return (
            <button
              key={tool.id}
              type="button"
              className={`markup-tool${selected ? ' active' : ''}`}
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={selected}
              onClick={() => onActiveToolChange(selected ? null : tool.id)}
            >
              <MarkupToolIcon tool={tool.id} />
            </button>
          )
        })}
      </div>

      {editing ? (
        <p className="markup-edit-hint">Editing selected markup</p>
      ) : null}

      <div className="markup-style-row">
        <label className="markup-style-field">
          <span className="markup-field-label">Color</span>
          <input
            type="color"
            value={color}
            onChange={(event) => {
              if (editing) {
                onSelectedStyleChange({ color: event.target.value })
              } else {
                onStyleChange({ ...style, color: event.target.value })
              }
            }}
            aria-label="Markup color"
          />
        </label>
        <label className="markup-style-field">
          <span className="markup-field-label">Stroke</span>
          <input
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            value={strokeWidth}
            onChange={(event) => {
              const next = Number(event.target.value) || strokeWidth
              if (editing) {
                onSelectedStyleChange({ strokeWidth: next })
              } else {
                onStyleChange({ ...style, strokeWidth: next })
              }
            }}
            aria-label="Stroke width"
          />
        </label>
        <label className="markup-style-field">
          <span className="markup-field-label">Hatch</span>
          <select
            value={hatch}
            disabled={!hatchEnabled}
            onChange={(event) => {
              const next = event.target.value as HatchPattern
              if (editing) {
                onSelectedStyleChange({ hatch: next })
              } else {
                onStyleChange({ ...style, hatch: next })
              }
            }}
            aria-label="Hatch pattern"
          >
            <option value="none">None</option>
            <option value="diagonal">Diagonal</option>
            <option value="crosshatch">Crosshatch</option>
          </select>
        </label>
      </div>

      {hatchEnabled && hatch !== 'none' ? (
        <div className="markup-style-row">
          <label className="markup-style-field">
            <span className="markup-field-label">Hatch scale</span>
            <input
              type="number"
              min={0.25}
              max={8}
              step={0.25}
              value={hatchScale}
              onChange={(event) => {
                const next = Number(event.target.value) || 1
                if (editing) {
                  onSelectedStyleChange({ hatchScale: next })
                } else {
                  onStyleChange({ ...style, hatchScale: next })
                }
              }}
              aria-label="Hatch scale"
            />
          </label>
          <label className="markup-style-field">
            <span className="markup-field-label">Hatch color</span>
            <input
              type="color"
              value={hatchColor}
              onChange={(event) => {
                if (editing) {
                  onSelectedStyleChange({ hatchColor: event.target.value })
                } else {
                  onStyleChange({ ...style, hatchColor: event.target.value })
                }
              }}
              aria-label="Hatch color"
            />
          </label>
        </div>
      ) : null}

      {textEnabled ? (
        <label className="markup-author-field">
          <span className="markup-field-label">Text</span>
          <textarea
            value={contents}
            rows={3}
            onChange={(event) => onSelectedStyleChange({ contents: event.target.value })}
            aria-label="Markup text"
          />
        </label>
      ) : null}

      <label className="markup-style-field markup-layer-field">
        <span className="markup-field-label">{editing ? 'Layer' : 'Active layer'}</span>
        <select
          value={layerValue}
          onChange={(event) => {
            const next = event.target.value || null
            if (editing) {
              onSelectedStyleChange({ layerId: next })
            } else {
              onActiveLayerChange(next)
            }
          }}
          aria-label={editing ? 'Markup layer' : 'Active layer for new markups'}
        >
          <option value="">None</option>
          {flatLayers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name || 'Untitled'}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
