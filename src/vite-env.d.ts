/// <reference types="vite/client" />

import type {
  BookmarkNode,
  FormFieldInfo,
  FormValueUpdate,
  LayerInfo,
  LayerMutationResult,
  MenuZoomCommand,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
  SaveDocumentResult,
  SetFormValuesResult,
  ViewMode,
} from '../shared/ipc'

type MarkStratumApi = {
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
  deleteLayer: (documentId: string, layerId: string) => Promise<LayerMutationResult>
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
