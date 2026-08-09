export type ViewMode = 'document' | 'drawing'

export type SizePts = {
  width: number
  height: number
}

export type PageInfo = SizePts & {
  index: number
  rotation: 0 | 1 | 2 | 3
}

export type DocumentInfo = {
  path: string
  fileName: string
  pageCount: number
  pages: PageInfo[]
}

export type OpenDocumentResult =
  | { ok: true; document: DocumentInfo }
  | { ok: false; needsPassword: true; path: string }
  | { ok: false; error: string }

export type RenderPageRequest = {
  pageIndex: number
  scale: number
  rotation?: 0 | 1 | 2 | 3
  requestId: string
}

export type RenderedPage = {
  pageIndex: number
  scale: number
  width: number
  height: number
  mimeType: 'image/jpeg'
  data: Uint8Array
  requestId: string
}

export type FitMode = 'width' | 'page' | 'custom'

export const IpcChannels = {
  openPath: 'pdf:openPath',
  openDialog: 'pdf:openDialog',
  close: 'pdf:close',
  renderPage: 'pdf:renderPage',
  menuOpen: 'menu:open',
  menuSetViewMode: 'menu:setViewMode',
  menuZoom: 'menu:zoom',
} as const

export type MenuZoomCommand = 'in' | 'out' | 'fitWidth' | 'fitPage' | 'actual'
