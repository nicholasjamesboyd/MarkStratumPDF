import type { RecentFileEntry } from '../../hooks/useRecentFiles'
import { BrandMark } from '../BrandMark'

type RecentFilesPanelProps = {
  entries: RecentFileEntry[]
  onOpen: (filePath: string) => void
  onClear: () => void
}

function directoryLabel(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) {
    return ''
  }
  return normalized.slice(0, lastSlash)
}

export function RecentFilesPanel({ entries, onOpen, onClear }: RecentFilesPanelProps) {
  return (
    <div className="recent-files-panel">
      {entries.length === 0 ? (
        <p className="recent-files-empty">No recent files yet. Open a PDF to see it here.</p>
      ) : (
        <ul className="recent-files-list">
          {entries.map((entry) => {
            const dir = directoryLabel(entry.path)
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  className="recent-file-item"
                  title={entry.path}
                  onClick={() => onOpen(entry.path)}
                >
                  <span className="recent-file-icon" aria-hidden="true">
                    <BrandMark size={16} />
                  </span>
                  <span className="recent-file-text">
                    <span className="recent-file-name">{entry.name}</span>
                    {dir ? <span className="recent-file-dir">{dir}</span> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {entries.length > 0 ? (
        <div className="recent-files-footer">
          <button type="button" className="recent-files-clear" onClick={onClear}>
            Clear recent
          </button>
        </div>
      ) : null}
    </div>
  )
}
