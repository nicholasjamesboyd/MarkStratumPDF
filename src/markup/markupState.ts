import type { HatchPattern, MarkupTool } from '../../shared/ipc'

export const AUTHOR_STORAGE_KEY = 'markstratum.authorName'

export const MARKUP_TOOLS: { id: MarkupTool; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'arc', label: 'Arc' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'polyline', label: 'Polyline' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'cloudCallout', label: 'Cloud Callout' },
  { id: 'callout', label: 'Callout' },
  { id: 'textBox', label: 'Text Box' },
  { id: 'pen', label: 'Pen' },
  { id: 'highlighter', label: 'Highlighter' },
]

export const CLOSED_SHAPE_TOOLS: ReadonlySet<MarkupTool> = new Set([
  'rectangle',
  'ellipse',
  'polygon',
  'cloud',
  'callout',
  'cloudCallout',
  'textBox',
])

export type MarkupDrawStyle = {
  color: string
  strokeWidth: number
  hatch: HatchPattern
}

export const DEFAULT_MARKUP_STYLE: MarkupDrawStyle = {
  color: '#e85d4c',
  strokeWidth: 2,
  hatch: 'none',
}

export function readAuthorName(): string {
  try {
    return localStorage.getItem(AUTHOR_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function writeAuthorName(name: string): void {
  try {
    localStorage.setItem(AUTHOR_STORAGE_KEY, name.trim())
  } catch {
    // ignore quota / private mode
  }
}

export function authorOrUnknown(name: string): string {
  const trimmed = name.trim()
  return trimmed || 'Unknown'
}

export function hexToRgb01(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  const value = Number.parseInt(full, 16)
  if (!Number.isFinite(value)) {
    return [1, 0, 0]
  }
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

export function markupToolLabel(tool: MarkupTool): string {
  return MARKUP_TOOLS.find((entry) => entry.id === tool)?.label ?? tool
}
