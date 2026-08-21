import { useEffect, useState } from 'react'
import type { HatchPattern, MarkupTool } from '../../../shared/ipc'
import {
  CLOSED_SHAPE_TOOLS,
  MARKUP_TOOLS,
  authorOrUnknown,
  readAuthorName,
  writeAuthorName,
  type MarkupDrawStyle,
} from '../../markup/markupState'
import { MarkupToolIcon } from '../MarkupToolIcon'

type MarkupPanelProps = {
  documentId: string | null
  activeTool: MarkupTool | null
  style: MarkupDrawStyle
  onActiveToolChange: (tool: MarkupTool | null) => void
  onStyleChange: (style: MarkupDrawStyle) => void
  onAuthorChange: (author: string) => void
}

export function MarkupPanel({
  documentId,
  activeTool,
  style,
  onActiveToolChange,
  onStyleChange,
  onAuthorChange,
}: MarkupPanelProps) {
  const [author, setAuthor] = useState(readAuthorName)

  useEffect(() => {
    onAuthorChange(authorOrUnknown(author))
  }, [author, onAuthorChange])

  const onAuthorInput = (value: string) => {
    setAuthor(value)
    writeAuthorName(value)
  }

  const hatchEnabled = activeTool !== null && CLOSED_SHAPE_TOOLS.has(activeTool)

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

      <div className="markup-style-row">
        <label className="markup-style-field">
          <span className="markup-field-label">Color</span>
          <input
            type="color"
            value={style.color}
            onChange={(event) => onStyleChange({ ...style, color: event.target.value })}
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
            value={style.strokeWidth}
            onChange={(event) =>
              onStyleChange({
                ...style,
                strokeWidth: Number(event.target.value) || style.strokeWidth,
              })
            }
            aria-label="Stroke width"
          />
        </label>
        <label className="markup-style-field">
          <span className="markup-field-label">Hatch</span>
          <select
            value={style.hatch}
            disabled={!hatchEnabled}
            onChange={(event) =>
              onStyleChange({ ...style, hatch: event.target.value as HatchPattern })
            }
            aria-label="Hatch pattern"
          >
            <option value="none">None</option>
            <option value="diagonal">Diagonal</option>
            <option value="crosshatch">Crosshatch</option>
          </select>
        </label>
      </div>
    </div>
  )
}
