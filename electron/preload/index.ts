import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcChannels,
  type BookmarkNode,
  type MenuZoomCommand,
  type OpenDocumentResult,
  type RenderedPage,
  type RenderPageRequest,
  type SaveDocumentResult,
  type ViewMode,
} from '../../shared/ipc'

export type MarkStratumApi = {
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

function subscribe<T extends unknown[]>(
  channel: string,
  handler: (...args: T) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: T) => {
    handler(...args)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api: MarkStratumApi = {
  openPath: (filePath, password) =>
    ipcRenderer.invoke(IpcChannels.openPath, filePath, password),
  openDialog: () => ipcRenderer.invoke(IpcChannels.openDialog),
  closeDocument: (documentId) => ipcRenderer.invoke(IpcChannels.close, documentId),
  renderPage: (req) => ipcRenderer.invoke(IpcChannels.renderPage, req),
  getBookmarks: (documentId) => ipcRenderer.invoke(IpcChannels.getBookmarks, documentId),
  saveDocument: (documentId) => ipcRenderer.invoke(IpcChannels.save, documentId),
  saveDocumentAs: (documentId) => ipcRenderer.invoke(IpcChannels.saveAs, documentId),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onMenuOpen: (handler) => subscribe(IpcChannels.menuOpen, handler),
  onMenuClose: (handler) => subscribe(IpcChannels.menuClose, handler),
  onMenuSave: (handler) => subscribe(IpcChannels.menuSave, handler),
  onMenuSaveAs: (handler) => subscribe(IpcChannels.menuSaveAs, handler),
  onMenuSetViewMode: (handler) =>
    subscribe<[ViewMode]>(IpcChannels.menuSetViewMode, handler),
  onMenuZoom: (handler) => subscribe<[MenuZoomCommand]>(IpcChannels.menuZoom, handler),
  onMenuToggleSplit: (handler) => subscribe(IpcChannels.menuToggleSplit, handler),
  onOpenPath: (handler) => subscribe<[string]>('app:open-path', handler),
  onOpenResult: (handler) =>
    subscribe<[OpenDocumentResult]>('app:open-result', handler),
}

contextBridge.exposeInMainWorld('markStratum', api)
