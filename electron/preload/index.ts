import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcChannels,
  type BookmarkMutationResult,
  type BookmarkNode,
  type FormFieldInfo,
  type FormValueUpdate,
  type LayerInfo,
  type LayerMutationResult,
  type MarkupCreateRequest,
  type MarkupInfo,
  type MarkupMutationResult,
  type MenuZoomCommand,
  type OpenDocumentResult,
  type PageCropRect,
  type PageMutationResult,
  type PickPdfPathResult,
  type ExtractPagesResult,
  type SplitDocumentResult,
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
  createBookmark: (
    documentId: string,
    pageIndex: number,
    title?: string,
    parentId?: string | null,
  ) => Promise<BookmarkMutationResult>
  renameBookmark: (
    documentId: string,
    bookmarkId: string,
    title: string,
  ) => Promise<BookmarkMutationResult>
  deleteBookmark: (
    documentId: string,
    bookmarkId: string,
  ) => Promise<BookmarkMutationResult>
  moveBookmark: (
    documentId: string,
    bookmarkId: string,
    parentId: string | null,
    index: number,
  ) => Promise<BookmarkMutationResult>
  getMarkups: (documentId: string) => Promise<MarkupInfo[]>
  createMarkup: (
    documentId: string,
    request: MarkupCreateRequest,
  ) => Promise<MarkupMutationResult>
  deleteMarkup: (documentId: string, markupId: string) => Promise<MarkupMutationResult>
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
  deletePages: (documentId: string, indices: number[]) => Promise<PageMutationResult>
  rotatePages: (
    documentId: string,
    indices: number[],
    quarterTurns: 1 | 3,
  ) => Promise<PageMutationResult>
  insertBlankPage: (documentId: string, insertAt: number) => Promise<PageMutationResult>
  cropPages: (
    documentId: string,
    pageIndices: number[],
    relativeCrop: PageCropRect,
  ) => Promise<PageMutationResult>
  replacePagesFromPath: (
    targetDocumentId: string,
    targetIndices: number[],
    filePath: string,
    sourceStartIndex: number,
  ) => Promise<PageMutationResult>
  replacePagesFromDocument: (
    targetDocumentId: string,
    targetIndices: number[],
    sourceDocumentId: string,
    sourceStartIndex: number,
  ) => Promise<PageMutationResult>
  extractPages: (
    documentId: string,
    indices: number[],
  ) => Promise<ExtractPagesResult | null>
  splitDocumentAtPage: (
    documentId: string,
    splitAt: number,
  ) => Promise<SplitDocumentResult | null>
  pickPdfPath: () => Promise<PickPdfPathResult>
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
  createBookmark: (documentId, pageIndex, title, parentId) =>
    ipcRenderer.invoke(IpcChannels.createBookmark, documentId, pageIndex, title, parentId),
  renameBookmark: (documentId, bookmarkId, title) =>
    ipcRenderer.invoke(IpcChannels.renameBookmark, documentId, bookmarkId, title),
  deleteBookmark: (documentId, bookmarkId) =>
    ipcRenderer.invoke(IpcChannels.deleteBookmark, documentId, bookmarkId),
  moveBookmark: (documentId, bookmarkId, parentId, index) =>
    ipcRenderer.invoke(IpcChannels.moveBookmark, documentId, bookmarkId, parentId, index),
  getMarkups: (documentId) => ipcRenderer.invoke(IpcChannels.getMarkups, documentId),
  createMarkup: (documentId, request) =>
    ipcRenderer.invoke(IpcChannels.createMarkup, documentId, request),
  deleteMarkup: (documentId, markupId) =>
    ipcRenderer.invoke(IpcChannels.deleteMarkup, documentId, markupId),
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
  deletePages: (documentId, indices) =>
    ipcRenderer.invoke(IpcChannels.deletePages, documentId, indices),
  rotatePages: (documentId, indices, quarterTurns) =>
    ipcRenderer.invoke(IpcChannels.rotatePages, documentId, indices, quarterTurns),
  insertBlankPage: (documentId, insertAt) =>
    ipcRenderer.invoke(IpcChannels.insertBlankPage, documentId, insertAt),
  cropPages: (documentId, pageIndices, relativeCrop) =>
    ipcRenderer.invoke(IpcChannels.cropPages, documentId, pageIndices, relativeCrop),
  replacePagesFromPath: (targetDocumentId, targetIndices, filePath, sourceStartIndex) =>
    ipcRenderer.invoke(
      IpcChannels.replacePagesFromPath,
      targetDocumentId,
      targetIndices,
      filePath,
      sourceStartIndex,
    ),
  replacePagesFromDocument: (targetDocumentId, targetIndices, sourceDocumentId, sourceStartIndex) =>
    ipcRenderer.invoke(
      IpcChannels.replacePagesFromDocument,
      targetDocumentId,
      targetIndices,
      sourceDocumentId,
      sourceStartIndex,
    ),
  extractPages: (documentId, indices) =>
    ipcRenderer.invoke(IpcChannels.extractPages, documentId, indices),
  splitDocumentAtPage: (documentId, splitAt) =>
    ipcRenderer.invoke(IpcChannels.splitDocumentAtPage, documentId, splitAt),
  pickPdfPath: () => ipcRenderer.invoke(IpcChannels.pickPdfPath),
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
