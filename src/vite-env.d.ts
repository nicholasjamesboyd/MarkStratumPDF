/// <reference types="vite/client" />

import type {
  BookmarkMutationResult,
  BookmarkNode,
  ExtractPagesResult,
  FormFieldInfo,
  FormValueUpdate,
  LayerInfo,
  LayerMutationResult,
  MarkupCreateRequest,
  MarkupInfo,
  MarkupMutationResult,
  MenuZoomCommand,
  OpenDocumentResult,
  PageCropRect,
  PageMutationResult,
  PickPdfPathResult,
  RenderedPage,
  RenderPageRequest,
  SaveDocumentResult,
  SetFormValuesResult,
  SplitDocumentResult,
  ViewMode,
} from '../shared/ipc'

type MarkStratumApi = {
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

declare global {
  interface Window {
    markStratum: MarkStratumApi
  }
}

export {}
