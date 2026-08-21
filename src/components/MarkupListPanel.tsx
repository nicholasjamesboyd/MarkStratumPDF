import { useState } from 'react'
import type { MarkupInfo } from '../../shared/ipc'
import { markupToolLabel } from '../markup/markupState'
import { MarkupToolIcon } from './MarkupToolIcon'

type MarkupListPanelProps = {
  documentId: string | null
  markups: MarkupInfo[]
  onDeleteMarkup: (markupId: string) => void
  onGoToPage: (pageIndex: number) => void
}

export function MarkupListPanel({
  documentId,
  markups,
  onDeleteMarkup,
  onGoToPage,
}: MarkupListPanelProps) {
  const [expanded, setExpanded] = useState(false)

  const countLabel = documentId
    ? markups.length === 1
      ? '1 markup'
      : `${markups.length} markups`
    : 'Markups'

  return (
    <div className={`markup-list-panel${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="markup-list-panel-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="markup-list-panel-chevron" aria-hidden="true">
          {expanded ? '▾' : '▴'}
        </span>
        <span className="markup-list-panel-title">Markups</span>
        <span className="markup-list-panel-count">{countLabel}</span>
      </button>

      {expanded ? (
        <div className="markup-list-panel-body">
          {!documentId ? (
            <p className="panel-empty">Open a PDF to see markups.</p>
          ) : markups.length === 0 ? (
            <p className="panel-empty">No markups on this PDF yet.</p>
          ) : (
            <ul className="markup-list">
              {markups.map((markup) => (
                <li key={markup.id} className="markup-list-item">
                  <button
                    type="button"
                    className="markup-list-main"
                    onClick={() => onGoToPage(markup.pageIndex)}
                    title={`Go to page ${markup.pageIndex + 1}`}
                  >
                    <span className="markup-list-icon" aria-hidden="true">
                      <MarkupToolIcon tool={markup.tool} />
                    </span>
                    <span className="markup-list-text">
                      <span className="markup-list-title">{markupToolLabel(markup.tool)}</span>
                      <span className="markup-list-meta">
                        {markup.author || 'Unknown'} · p. {markup.pageIndex + 1}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="markup-list-delete"
                    aria-label={`Delete ${markupToolLabel(markup.tool)}`}
                    onClick={() => onDeleteMarkup(markup.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
