/// <reference types="vite/client" />

import type {
  BookmarkNode,
  MenuZoomCommand,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
  SaveDocumentResult,
  ViewMode,
} from '../shared/ipc'

type MarkStratumApi = {
  openPath: (filePath: string, password?: string) => Promise<OpenDocumentResult>
  openDialog: () => Promise<OpenDocumentResult | null>
  closeDocument: (documentId: string) => Promise<void>
  renderPage: (req: RenderPageRequest) => Promise<RenderedPage>
  getBookmarks: (documentId: string) => Promise<BookmarkNode[]>
  saveDocument: (documentId: string) => Promise<SaveDocumentResult>
  saveDocumentAs: (documentId: string) => Promise<SaveDocumentResult | null>
  getPathForFile: (file: File) => string
  onMenuOpen: (handler: () => void) => () => void
  onMenuClose: (handler: () => void) => () => void
  onMenuSave: (handler: () => void) => () => void
  onMenuSaveAs: (handler: () => void) => () => void
  onMenuSetViewMode: (handler: (mode: ViewMode) => void) => () => void
  onMenuZoom: (handler: (command: MenuZoomCommand) => void) => () => void
  onMenuToggleSplit: (handler: () => void) => () => void
  onOpenPath: (handler: (filePath: string) => void) => () => void
  onOpenResult: (handler: (result: OpenDocumentResult) => void) => () => void
}

declare global {
  interface Window {
    markStratum: MarkStratumApi
  }
}

export {}
