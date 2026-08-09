import type { RecentFileEntry } from '../../hooks/useRecentFiles'

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
                    <svg viewBox="0 0 16 16" width="14" height="14">
                      <path
                        fill="currentColor"
                        d="M3 1.5h6.3L13 5.2V14a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14V1.5zm6.1.7V5h3.2L9.1 2.2z"
                      />
                    </svg>
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
