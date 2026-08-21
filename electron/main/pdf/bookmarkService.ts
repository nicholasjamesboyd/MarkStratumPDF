import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFObject,
} from 'pdf-lib'
import type { BookmarkActionType, BookmarkNode } from '../../../shared/ipc'

const OUTLINES = PDFName.of('Outlines')
const TITLE = PDFName.of('Title')
const PARENT = PDFName.of('Parent')
const PREV = PDFName.of('Prev')
const NEXT = PDFName.of('Next')
const FIRST = PDFName.of('First')
const LAST = PDFName.of('Last')
const COUNT = PDFName.of('Count')
const DEST = PDFName.of('Dest')
const ACTION = PDFName.of('A')
const ACTION_TYPE = PDFName.of('S')
const ACTION_DEST = PDFName.of('D')
const URI = PDFName.of('URI')
const GOTO = PDFName.of('GoTo')
const URI_ACTION = PDFName.of('URI')
const XYZ = PDFName.of('XYZ')

type DraftNode = {
  id?: string
  title: string
  pageIndex?: number
  open: boolean
  actionType?: BookmarkActionType
  url?: string
  children: DraftNode[]
}

export async function listBookmarksFromBytes(bytes: Uint8Array): Promise<BookmarkNode[]> {
  const pdf = await loadPdf(bytes)
  return listBookmarks(pdf)
}

export async function createBookmarkInBytes(
  bytes: Uint8Array,
  pageIndex: number,
  title: string,
  parentId?: string | null,
): Promise<{ bytes: Uint8Array; bookmarkId: string }> {
  const pdf = await loadPdf(bytes)
  const pageCount = pdf.getPageCount()
  if (pageIndex < 0 || pageIndex >= pageCount) {
    throw new Error(`Page index out of range: ${pageIndex}`)
  }

  const tree = listBookmarks(pdf).map(toDraft)
  const trimmed = title.trim() || `Page ${pageIndex + 1}`
  const created: DraftNode = {
    title: trimmed,
    pageIndex,
    open: true,
    actionType: 'goto',
    children: [],
  }

  if (parentId) {
    const parent = findDraft(tree, parentId)
    if (!parent) {
      throw new Error(`Bookmark not found: ${parentId}`)
    }
    parent.children.push(created)
    parent.open = true
  } else {
    tree.push(created)
  }

  writeOutline(pdf, tree)
  const saved = await pdf.save({ useObjectStreams: false })
  const listed = await listBookmarksFromBytes(saved)
  const bookmarkId = findCreatedId(listed, parentId ?? null, trimmed, pageIndex)
  if (!bookmarkId) {
    throw new Error('Created bookmark could not be resolved.')
  }
  return { bytes: saved, bookmarkId }
}

export async function renameBookmarkInBytes(
  bytes: Uint8Array,
  bookmarkId: string,
  title: string,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const tree = listBookmarks(pdf).map(toDraft)
  const target = findDraft(tree, bookmarkId)
  if (!target) {
    throw new Error(`Bookmark not found: ${bookmarkId}`)
  }
  const trimmed = title.trim()
  if (!trimmed) {
    throw new Error('Bookmark title cannot be empty.')
  }
  target.title = trimmed
  writeOutline(pdf, tree)
  return pdf.save({ useObjectStreams: false })
}

export async function deleteBookmarkInBytes(
  bytes: Uint8Array,
  bookmarkId: string,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const tree = listBookmarks(pdf).map(toDraft)
  if (!removeDraft(tree, bookmarkId)) {
    throw new Error(`Bookmark not found: ${bookmarkId}`)
  }
  writeOutline(pdf, tree)
  return pdf.save({ useObjectStreams: false })
}

export async function moveBookmarkInBytes(
  bytes: Uint8Array,
  bookmarkId: string,
  parentId: string | null,
  index: number,
): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes)
  const tree = listBookmarks(pdf).map(toDraft)
  const moved = detachDraft(tree, bookmarkId)
  if (!moved) {
    throw new Error(`Bookmark not found: ${bookmarkId}`)
  }

  if (parentId && (parentId === bookmarkId || isDescendant(moved, parentId))) {
    throw new Error('Cannot move a bookmark into its own descendant.')
  }

  const siblings = parentId ? findDraft(tree, parentId)?.children : tree
  if (!siblings) {
    throw new Error(`Bookmark not found: ${parentId}`)
  }

  const insertAt = Math.max(0, Math.min(index, siblings.length))
  siblings.splice(insertAt, 0, moved)
  if (parentId) {
    const parent = findDraft(tree, parentId)
    if (parent) {
      parent.open = true
    }
  }

  writeOutline(pdf, tree)
  return pdf.save({ useObjectStreams: false })
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
    if (pdf.isEncrypted) {
      throw new Error('Cannot edit bookmarks in an encrypted PDF yet.')
    }
    return pdf
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/encrypt|password|security/i.test(message)) {
      throw new Error('Cannot edit bookmarks in an encrypted PDF yet.')
    }
    if (message.startsWith('Cannot edit bookmarks')) {
      throw error
    }
    throw new Error(`Could not open PDF for bookmarks: ${message}`)
  }
}

function listBookmarks(pdf: PDFDocument): BookmarkNode[] {
  const outlines = pdf.catalog.lookupMaybe(OUTLINES, PDFDict)
  if (!outlines) {
    return []
  }
  const first = outlines.get(FIRST)
  if (!(first instanceof PDFRef)) {
    return []
  }
  return walkSiblings(pdf, first)
}

function walkSiblings(pdf: PDFDocument, firstRef: PDFRef): BookmarkNode[] {
  const nodes: BookmarkNode[] = []
  let current: PDFRef | null = firstRef
  const seen = new Set<string>()

  while (current) {
    const id = refId(current)
    if (seen.has(id)) {
      break
    }
    seen.add(id)

    const dict: PDFDict | undefined = pdf.context.lookupMaybe(current, PDFDict)
    if (!dict) {
      break
    }

    nodes.push(toBookmarkNode(pdf, current, dict))
    const next: PDFObject | undefined = dict.get(NEXT)
    current = next instanceof PDFRef ? next : null
  }

  return nodes
}

function toBookmarkNode(pdf: PDFDocument, ref: PDFRef, dict: PDFDict): BookmarkNode {
  const childrenRef = dict.get(FIRST)
  const children =
    childrenRef instanceof PDFRef ? walkSiblings(pdf, childrenRef) : undefined
  const countObj = dict.lookupMaybe(COUNT, PDFNumber)
  const count = countObj ? countObj.asNumber() : 0
  const hasChildren = Boolean(children?.length)
  const open = hasChildren ? count >= 0 : true

  const { pageIndex, actionType, url } = parseDestination(pdf, dict)

  return {
    id: refId(ref),
    title: readTitle(dict),
    pageIndex,
    open,
    actionType,
    url,
    children: children?.length ? children : undefined,
  }
}

function parseDestination(
  pdf: PDFDocument,
  dict: PDFDict,
): { pageIndex?: number; actionType: BookmarkActionType; url?: string } {
  const dest = dict.get(DEST)
  if (dest) {
    const pageIndex = pageIndexFromDest(pdf, dest)
    return {
      pageIndex,
      actionType: typeof pageIndex === 'number' ? 'goto' : 'unknown',
    }
  }

  const action = dict.lookupMaybe(ACTION, PDFDict)
  if (!action) {
    return { actionType: 'unknown' }
  }

  const subtype = action.get(ACTION_TYPE)
  if (subtype instanceof PDFName && subtype === URI_ACTION) {
    const uriValue = action.get(URI)
    const url = decodePdfText(action.context.lookup(uriValue) ?? uriValue)
    return { actionType: 'uri', url: url || undefined }
  }

  if (subtype instanceof PDFName && subtype === GOTO) {
    const actionDest = action.get(ACTION_DEST)
    const pageIndex = actionDest ? pageIndexFromDest(pdf, actionDest) : undefined
    return {
      pageIndex,
      actionType: typeof pageIndex === 'number' ? 'goto' : 'unknown',
    }
  }

  return { actionType: 'unknown' }
}

function pageIndexFromDest(pdf: PDFDocument, dest: PDFObject): number | undefined {
  const resolved = dest instanceof PDFRef ? pdf.context.lookup(dest) : dest
  if (resolved instanceof PDFArray) {
    const first = resolved.get(0)
    if (first instanceof PDFRef) {
      return pageIndexFromRef(pdf, first)
    }
    return undefined
  }
  return undefined
}

function pageIndexFromRef(pdf: PDFDocument, ref: PDFRef): number | undefined {
  const pages = pdf.getPages()
  for (let i = 0; i < pages.length; i += 1) {
    if (sameRef(pages[i].ref, ref)) {
      return i
    }
  }
  return undefined
}

function writeOutline(pdf: PDFDocument, roots: DraftNode[]): void {
  if (roots.length === 0) {
    pdf.catalog.delete(OUTLINES)
    return
  }

  const existingOutlines = pdf.catalog.get(OUTLINES)
  const outlinesRef =
    existingOutlines instanceof PDFRef ? existingOutlines : pdf.context.nextRef()

  const refMap = new Map<DraftNode, PDFRef>()
  allocateRefs(pdf, roots, refMap)

  const { first, last, descendantCount } = writeNodes(pdf, roots, outlinesRef, refMap)

  const outlinesDict = pdf.context.obj({
    Type: 'Outlines',
    First: first,
    Last: last,
    Count: descendantCount,
  }) as PDFDict
  pdf.context.assign(outlinesRef, outlinesDict)
  pdf.catalog.set(OUTLINES, outlinesRef)
}

function allocateRefs(
  pdf: PDFDocument,
  nodes: DraftNode[],
  refMap: Map<DraftNode, PDFRef>,
): void {
  for (const node of nodes) {
    const parsed = node.id ? Number(node.id) : NaN
    const ref =
      Number.isFinite(parsed) && parsed > 0 ? PDFRef.of(parsed) : pdf.context.nextRef()
    refMap.set(node, ref)
    allocateRefs(pdf, node.children, refMap)
  }
}

function writeNodes(
  pdf: PDFDocument,
  nodes: DraftNode[],
  parentRef: PDFRef,
  refMap: Map<DraftNode, PDFRef>,
): { first: PDFRef; last: PDFRef; descendantCount: number } {
  const refs = nodes.map((node) => refMap.get(node)!)
  let descendantCount = 0

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!
    const ref = refs[i]!
    const children = node.children
    let childFirst: PDFRef | undefined
    let childLast: PDFRef | undefined
    let childCount = 0

    if (children.length > 0) {
      const written = writeNodes(pdf, children, ref, refMap)
      childFirst = written.first
      childLast = written.last
      childCount = written.descendantCount
    }

    descendantCount += 1 + childCount

    const fields: Record<string, PDFObject | PDFRef | string | number> = {
      Title: PDFHexString.fromText(node.title || 'Untitled'),
      Parent: parentRef,
    }

    if (i > 0) {
      fields.Prev = refs[i - 1]!
    }
    if (i < nodes.length - 1) {
      fields.Next = refs[i + 1]!
    }
    if (childFirst && childLast) {
      fields.First = childFirst
      fields.Last = childLast
      fields.Count = node.open === false ? -childCount : childCount
    }

    if (typeof node.pageIndex === 'number') {
      const page = pdf.getPage(node.pageIndex)
      fields.Dest = pdf.context.obj([page.ref, XYZ, null, null, null])
    } else if (node.url) {
      fields.A = pdf.context.obj({
        S: 'URI',
        URI: PDFString.of(node.url),
      })
    }

    pdf.context.assign(ref, pdf.context.obj(fields) as PDFDict)
  }

  return {
    first: refs[0]!,
    last: refs[refs.length - 1]!,
    descendantCount,
  }
}

function toDraft(node: BookmarkNode): DraftNode {
  return {
    id: node.id,
    title: node.title,
    pageIndex: node.pageIndex,
    open: node.open,
    actionType: node.actionType,
    url: node.url,
    children: (node.children ?? []).map(toDraft),
  }
}

function findDraft(nodes: DraftNode[], id: string): DraftNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const nested = findDraft(node.children, id)
    if (nested) {
      return nested
    }
  }
  return null
}

function removeDraft(nodes: DraftNode[], id: string): boolean {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) {
    nodes.splice(index, 1)
    return true
  }
  for (const node of nodes) {
    if (removeDraft(node.children, id)) {
      return true
    }
  }
  return false
}

function detachDraft(nodes: DraftNode[], id: string): DraftNode | null {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) {
    return nodes.splice(index, 1)[0] ?? null
  }
  for (const node of nodes) {
    const nested = detachDraft(node.children, id)
    if (nested) {
      return nested
    }
  }
  return null
}

function isDescendant(node: DraftNode, id: string): boolean {
  for (const child of node.children) {
    if (child.id === id || isDescendant(child, id)) {
      return true
    }
  }
  return false
}

function findCreatedId(
  nodes: BookmarkNode[],
  parentId: string | null,
  title: string,
  pageIndex: number,
): string | undefined {
  const siblings = parentId ? findBookmark(nodes, parentId)?.children ?? [] : nodes
  for (let i = siblings.length - 1; i >= 0; i -= 1) {
    const node = siblings[i]!
    if (node.title === title && node.pageIndex === pageIndex) {
      return node.id
    }
  }
  return undefined
}

function findBookmark(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const nested = findBookmark(node.children ?? [], id)
    if (nested) {
      return nested
    }
  }
  return null
}

function readTitle(dict: PDFDict): string {
  const value = dict.get(TITLE)
  if (!value) {
    return ''
  }
  return decodePdfText(dict.context.lookup(value) ?? value)
}

function decodePdfText(value: PDFObject | undefined): string {
  if (!value) {
    return ''
  }
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try {
      return value.decodeText()
    } catch {
      return value.asString()
    }
  }
  if (value instanceof PDFName) {
    return value.decodeText()
  }
  return ''
}

function sameRef(a: PDFRef, b: PDFRef): boolean {
  return a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber
}

function refId(ref: PDFRef): string {
  return String(ref.objectNumber)
}
