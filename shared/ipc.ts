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
  documentId: string
  path: string
  fileName: string
  pageCount: number
  pages: PageInfo[]
}

export type BookmarkActionType =
  | 'goto'
  | 'remoteGoto'
  | 'uri'
  | 'launch'
  | 'embeddedGoto'
  | 'unknown'

export type BookmarkNode = {
  title: string
  pageIndex?: number
  open: boolean
  actionType?: BookmarkActionType
  url?: string
  children?: BookmarkNode[]
}

export type OpenDocumentResult =
  | { ok: true; document: DocumentInfo }
  | { ok: false; needsPassword: true; path: string }
  | { ok: false; error: string }

export type SaveDocumentResult =
  | { ok: true; document: DocumentInfo }
  | { ok: false; error: string }

export type RenderPageRequest = {
  documentId: string
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
  dataBase64: string
  requestId: string
}

export type FitMode = 'width' | 'page' | 'custom'

export const IpcChannels = {
  openPath: 'pdf:openPath',
  openDialog: 'pdf:openDialog',
  close: 'pdf:close',
  renderPage: 'pdf:renderPage',
  getBookmarks: 'pdf:getBookmarks',
  save: 'pdf:save',
  saveAs: 'pdf:saveAs',
  menuOpen: 'menu:open',
  menuClose: 'menu:close',
  menuSave: 'menu:save',
  menuSaveAs: 'menu:saveAs',
  menuSetViewMode: 'menu:setViewMode',
  menuZoom: 'menu:zoom',
  menuToggleSplit: 'menu:toggleSplit',
} as const

export type MenuZoomCommand = 'in' | 'out' | 'fitWidth' | 'fitPage' | 'actual'
