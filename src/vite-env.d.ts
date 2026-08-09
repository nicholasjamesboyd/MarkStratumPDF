/// <reference types="vite/client" />

import type {
  MenuZoomCommand,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
  ViewMode,
} from '../shared/ipc'

type RedColumnApi = {
  openPath: (filePath: string, password?: string) => Promise<OpenDocumentResult>
  openDialog: () => Promise<OpenDocumentResult | null>
  closeDocument: () => Promise<void>
  renderPage: (req: RenderPageRequest) => Promise<RenderedPage>
  getPathForFile: (file: File) => string
  onMenuOpen: (handler: () => void) => () => void
  onMenuSetViewMode: (handler: (mode: ViewMode) => void) => () => void
  onMenuZoom: (handler: (command: MenuZoomCommand) => void) => () => void
  onOpenPath: (handler: (filePath: string) => void) => () => void
}

declare global {
  interface Window {
    redColumn: RedColumnApi
  }
}

export {}
