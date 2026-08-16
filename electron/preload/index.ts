import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcChannels,
  type BookmarkNode,
  type FormFieldInfo,
  type FormValueUpdate,
  type LayerInfo,
  type LayerMutationResult,
  type MenuZoomCommand,
  type OpenDocumentResult,
  type PageMutationResult,
  type RenderedPage,
  type RenderPageRequest,
  type SaveDocumentResult,
  type SetFormValuesResult,
  type ViewMode,
} from '../../shared/ipc'

export type MarkStratumApi = {
  openPath: (filePath: string, password?: string) => Promise<OpenDocumentResult>
  openDialog: () => Promise<OpenDocumentResult | null>
  closeDocument: (documentId: string) => Promise<void>
  renderPage: (req: RenderPageRequest) => Promise<RenderedPage>
  getBookmarks: (documentId: string) => Promise<BookmarkNode[]>
  getFormFields: (documentId: string) => Promise<FormFieldInfo[]>
  setFormValues: (
    documentId: string,
    updates: FormValueUpdate[],
  ) => Promise<SetFormValuesResult>
  getLayers: (documentId: string) => Promise<LayerInfo[]>
  setLayerVisibility: (
    documentId: string,
    layerId: string,
    visible: boolean,
  ) => Promise<LayerMutationResult>
  createLayer: (
    documentId: string,
    name: string,
    visible?: boolean,
  ) => Promise<LayerMutationResult>
  renameLayer: (
    documentId: string,
    layerId: string,
    name: string,
  ) => Promise<LayerMutationResult>
  deleteLayer: (
    documentId: string,
    layerId: string,
  ) => Promise<LayerMutationResult>
  reorderPages: (
    documentId: string,
    fromIndex: number,
    toIndex: number,
  ) => Promise<PageMutationResult>
  insertPagesFromDocument: (
    targetDocumentId: string,
    sourceDocumentId: string,
    insertAt: number,
  ) => Promise<PageMutationResult>
  insertPagesFromPath: (
    targetDocumentId: string,
    filePath: string,
    insertAt: number,
  ) => Promise<PageMutationResult>
  saveDocument: (documentId: string) => Promise<SaveDocumentResult>
  saveDocumentAs: (documentId: string) => Promise<SaveDocumentResult | null>
  takePendingOpenPath: () => Promise<string | null>
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
  getFormFields: (documentId) => ipcRenderer.invoke(IpcChannels.getFormFields, documentId),
  setFormValues: (documentId, updates) =>
    ipcRenderer.invoke(IpcChannels.setFormValues, documentId, updates),
  getLayers: (documentId) => ipcRenderer.invoke(IpcChannels.getLayers, documentId),
  setLayerVisibility: (documentId, layerId, visible) =>
    ipcRenderer.invoke(IpcChannels.setLayerVisibility, documentId, layerId, visible),
  createLayer: (documentId, name, visible) =>
    ipcRenderer.invoke(IpcChannels.createLayer, documentId, name, visible),
  renameLayer: (documentId, layerId, name) =>
    ipcRenderer.invoke(IpcChannels.renameLayer, documentId, layerId, name),
  deleteLayer: (documentId, layerId) =>
    ipcRenderer.invoke(IpcChannels.deleteLayer, documentId, layerId),
  reorderPages: (documentId, fromIndex, toIndex) =>
    ipcRenderer.invoke(IpcChannels.reorderPages, documentId, fromIndex, toIndex),
  insertPagesFromDocument: (targetDocumentId, sourceDocumentId, insertAt) =>
    ipcRenderer.invoke(
      IpcChannels.insertPagesFromDocument,
      targetDocumentId,
      sourceDocumentId,
      insertAt,
    ),
  insertPagesFromPath: (targetDocumentId, filePath, insertAt) =>
    ipcRenderer.invoke(IpcChannels.insertPagesFromPath, targetDocumentId, filePath, insertAt),
  saveDocument: (documentId) => ipcRenderer.invoke(IpcChannels.save, documentId),
  saveDocumentAs: (documentId) => ipcRenderer.invoke(IpcChannels.saveAs, documentId),
  takePendingOpenPath: () => ipcRenderer.invoke(IpcChannels.takePendingOpenPath),
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
