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
  dirty?: boolean
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

export type FormFieldType =
  | 'textField'
  | 'checkbox'
  | 'radioButton'
  | 'comboBox'
  | 'listBox'

export type FormFieldBounds = {
  left: number
  bottom: number
  right: number
  top: number
}

export type FormFieldOption = {
  label: string
  isSelected: boolean
}

export type FormFieldInfo = {
  pageIndex: number
  name: string
  type: FormFieldType
  value: string
  isChecked: boolean
  exportValue?: string
  alternateName?: string
  flags: number
  bounds?: FormFieldBounds
  options?: FormFieldOption[]
  readOnly: boolean
  multiline: boolean
}

export type FormValueUpdate = {
  name: string
  value: string
}

export type SetFormValuesResult =
  | { ok: true; document: DocumentInfo }
  | { ok: false; error: string }

export type OpenDocumentResult =
  | { ok: true; document: DocumentInfo }
  | { ok: false; needsPassword: true; path: string }
  | { ok: false; error: string }

export type SaveDocumentResult =
  | { ok: true; document: DocumentInfo }
  | { ok: false; error: string }

export type LayerInfo = {
  id: string
  name: string
  visible: boolean
  locked?: boolean
  depth: number
  children?: LayerInfo[]
}

export type LayerMutationResult =
  | { ok: true; document: DocumentInfo; layers: LayerInfo[]; layersRevision: number }
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
  getFormFields: 'pdf:getFormFields',
  setFormValues: 'pdf:setFormValues',
  getLayers: 'pdf:getLayers',
  setLayerVisibility: 'pdf:setLayerVisibility',
  createLayer: 'pdf:createLayer',
  renameLayer: 'pdf:renameLayer',
  deleteLayer: 'pdf:deleteLayer',
  save: 'pdf:save',
  saveAs: 'pdf:saveAs',
  takePendingOpenPath: 'app:takePendingOpenPath',
  menuOpen: 'menu:open',
  menuClose: 'menu:close',
  menuSave: 'menu:save',
  menuSaveAs: 'menu:saveAs',
  menuSetViewMode: 'menu:setViewMode',
  menuZoom: 'menu:zoom',
  menuToggleSplit: 'menu:toggleSplit',
} as const

export type MenuZoomCommand = 'in' | 'out' | 'fitWidth' | 'fitPage' | 'actual'

/** PDF AcroForm field flag bits (1-based in the PDF spec). */
export const FormFieldFlags = {
  readOnly: 1 << 0,
  required: 1 << 1,
  noExport: 1 << 2,
  multiline: 1 << 12,
  password: 1 << 13,
} as const
