import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcChannels,
  type MenuZoomCommand,
  type OpenDocumentResult,
  type RenderedPage,
  type RenderPageRequest,
  type ViewMode,
} from '../../shared/ipc'

export type MarkStratumApi = {
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
  closeDocument: () => ipcRenderer.invoke(IpcChannels.close),
  renderPage: (req) => ipcRenderer.invoke(IpcChannels.renderPage, req),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onMenuOpen: (handler) => subscribe(IpcChannels.menuOpen, handler),
  onMenuSetViewMode: (handler) =>
    subscribe<[ViewMode]>(IpcChannels.menuSetViewMode, handler),
  onMenuZoom: (handler) => subscribe<[MenuZoomCommand]>(IpcChannels.menuZoom, handler),
  onOpenPath: (handler) => subscribe<[string]>('app:open-path', handler),
}

contextBridge.exposeInMainWorld('markStratum', api)
