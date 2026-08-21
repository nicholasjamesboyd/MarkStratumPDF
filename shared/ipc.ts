export type ViewMode = 'document' | 'drawing'

export type SizePts = {
  width: number
  height: number
}

export type PageInfo = SizePts & {
  index: number
  rotation: 0 | 1 | 2 | 3
}

export function displayPageSize(page: Pick<PageInfo, 'width' | 'height' | 'rotation'>): SizePts {
  // PDFium reports width/height in the orientation viewers use (rotation already applied).
  return { width: page.width, height: page.height }
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
  id: string
  title: string
  pageIndex?: number
  open: boolean
  actionType?: BookmarkActionType
  url?: string
  children?: BookmarkNode[]
}

export type BookmarkMutationResult =
  | { ok: true; document: DocumentInfo; bookmarks: BookmarkNode[]; bookmarksRevision: number }
  | { ok: false; error: string }

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

export type PageMutationResult =
  | { ok: true; document: DocumentInfo; pagesRevision: number }
  | { ok: false; error: string }

export type MarkupTool =
  | 'line'
  | 'rectangle'
  | 'arc'
  | 'ellipse'
  | 'arrow'
  | 'polyline'
  | 'polygon'
  | 'cloud'
  | 'cloudCallout'
  | 'callout'
  | 'textBox'
  | 'pen'
  | 'highlighter'

export type HatchPattern = 'none' | 'diagonal' | 'crosshatch'

export type MarkupPoint = {
  x: number
  y: number
}

export type MarkupStyle = {
  /** RGB components in 0–1. */
  color: [number, number, number]
  strokeWidth: number
  hatch: HatchPattern
  opacity?: number
  contents?: string
}

export type MarkupCreateRequest = {
  pageIndex: number
  tool: MarkupTool
  author: string
  style: MarkupStyle
  /** Page-space points (PDF Y-up). Meaning depends on tool. */
  points: MarkupPoint[]
}

export type MarkupInfo = {
  id: string
  pageIndex: number
  tool: MarkupTool
  author: string
  createdAt?: string
  contents?: string
  bounds: FormFieldBounds
  hatch: HatchPattern
  color: [number, number, number]
  strokeWidth: number
  points: MarkupPoint[]
}

export type MarkupMutationResult =
  | { ok: true; document: DocumentInfo; markups: MarkupInfo[]; markupsRevision: number }
  | { ok: false; error: string }

export type PageCropRect = {
  /** Fraction of MediaBox width from left edge (0–1). */
  left: number
  /** Fraction of MediaBox height from bottom edge (0–1). */
  bottom: number
  /** Fraction of MediaBox width (0–1). */
  width: number
  /** Fraction of MediaBox height (0–1). */
  height: number
}

export type SplitDocumentResult =
  | { ok: true; document: DocumentInfo; pagesRevision: number; savedPath?: string }
  | { ok: false; error: string }

export type ExtractPagesResult =
  | { ok: true; savedPath: string }
  | { ok: false; error: string }

export type PickPdfPathResult = { ok: true; path: string } | null

export const PageDragMime = 'application/x-markstratum-page'
export const TabDragMime = 'application/x-markstratum-tab'
export const BookmarkDragMime = 'application/x-markstratum-bookmark'

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
  createBookmark: 'pdf:createBookmark',
  renameBookmark: 'pdf:renameBookmark',
  deleteBookmark: 'pdf:deleteBookmark',
  moveBookmark: 'pdf:moveBookmark',
  getMarkups: 'pdf:getMarkups',
  createMarkup: 'pdf:createMarkup',
  deleteMarkup: 'pdf:deleteMarkup',
  getFormFields: 'pdf:getFormFields',
  setFormValues: 'pdf:setFormValues',
  getLayers: 'pdf:getLayers',
  setLayerVisibility: 'pdf:setLayerVisibility',
  createLayer: 'pdf:createLayer',
  renameLayer: 'pdf:renameLayer',
  deleteLayer: 'pdf:deleteLayer',
  reorderPages: 'pdf:reorderPages',
  insertPagesFromDocument: 'pdf:insertPagesFromDocument',
  insertPagesFromPath: 'pdf:insertPagesFromPath',
  deletePages: 'pdf:deletePages',
  rotatePages: 'pdf:rotatePages',
  insertBlankPage: 'pdf:insertBlankPage',
  extractPages: 'pdf:extractPages',
  splitDocumentAtPage: 'pdf:splitDocumentAtPage',
  replacePagesFromPath: 'pdf:replacePagesFromPath',
  replacePagesFromDocument: 'pdf:replacePagesFromDocument',
  cropPages: 'pdf:cropPages',
  pickPdfPath: 'pdf:pickPdfPath',
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
