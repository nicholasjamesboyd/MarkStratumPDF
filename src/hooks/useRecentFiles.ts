import { useCallback, useState } from 'react'

export type RecentFileEntry = {
  path: string
  name: string
  openedAt: number
}

const STORAGE_KEY = 'markstratum.recentFiles'
const MAX_RECENT = 15

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

function readStored(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter(
        (item): item is RecentFileEntry =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as RecentFileEntry).path === 'string' &&
          typeof (item as RecentFileEntry).name === 'string' &&
          typeof (item as RecentFileEntry).openedAt === 'number',
      )
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function writeStored(entries: RecentFileEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function pushRecentFile(
  entries: RecentFileEntry[],
  filePath: string,
  openedAt = Date.now(),
): RecentFileEntry[] {
  const next: RecentFileEntry = {
    path: filePath,
    name: fileNameFromPath(filePath),
    openedAt,
  }
  const filtered = entries.filter(
    (entry) => normalizePath(entry.path) !== normalizePath(filePath),
  )
  return [next, ...filtered].slice(0, MAX_RECENT)
}

export function useRecentFiles() {
  const [entries, setEntries] = useState<RecentFileEntry[]>(() => readStored())

  const recordOpen = useCallback((filePath: string) => {
    setEntries((prev) => {
      const next = pushRecentFile(prev, filePath)
      writeStored(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    writeStored([])
    setEntries([])
  }, [])

  return { entries, recordOpen, clear }
}
