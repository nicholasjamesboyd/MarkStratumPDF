import { PDFDocument, PDFName, PDFHexString, PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  createBookmarkInBytes,
  deleteBookmarkInBytes,
  listBookmarksFromBytes,
  moveBookmarkInBytes,
  renameBookmarkInBytes,
} from '../electron/main/pdf/bookmarkService'

async function createBlankPdf(pageCount = 3): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) {
    pdf.addPage([200, 200])
  }
  return pdf.save({ useObjectStreams: false })
}

describe('bookmarkService', () => {
  it('returns an empty list for PDFs without outlines', async () => {
    const bytes = await createBlankPdf()
    expect(await listBookmarksFromBytes(bytes)).toEqual([])
  })

  it('creates, renames, nests, reorders, and deletes bookmarks', async () => {
    const empty = await createBlankPdf(3)

    const first = await createBookmarkInBytes(empty, 0, 'Cover')
    let bookmarks = await listBookmarksFromBytes(first.bytes)
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]?.title).toBe('Cover')
    expect(bookmarks[0]?.pageIndex).toBe(0)
    expect(bookmarks[0]?.id).toBe(first.bookmarkId)

    const second = await createBookmarkInBytes(first.bytes, 1, 'Chapter 1')
    bookmarks = await listBookmarksFromBytes(second.bytes)
    expect(bookmarks.map((node) => node.title)).toEqual(['Cover', 'Chapter 1'])

    const nested = await createBookmarkInBytes(
      second.bytes,
      2,
      'Section A',
      second.bookmarkId,
    )
    bookmarks = await listBookmarksFromBytes(nested.bytes)
    expect(bookmarks).toHaveLength(2)
    expect(bookmarks[1]?.children).toHaveLength(1)
    expect(bookmarks[1]?.children?.[0]?.title).toBe('Section A')
    expect(bookmarks[1]?.children?.[0]?.pageIndex).toBe(2)

    const renamed = await renameBookmarkInBytes(nested.bytes, nested.bookmarkId, 'Section Alpha')
    bookmarks = await listBookmarksFromBytes(renamed)
    expect(bookmarks[1]?.children?.[0]?.title).toBe('Section Alpha')

    const sectionId = bookmarks[1]!.children![0]!.id
    const coverId = bookmarks[0]!.id
    const moved = await moveBookmarkInBytes(renamed, sectionId, coverId, 0)
    bookmarks = await listBookmarksFromBytes(moved)
    expect(bookmarks[0]?.children?.[0]?.title).toBe('Section Alpha')
    expect(bookmarks[1]?.children ?? []).toHaveLength(0)

    const chapterId = bookmarks[1]!.id
    const reordered = await moveBookmarkInBytes(moved, chapterId, null, 0)
    bookmarks = await listBookmarksFromBytes(reordered)
    expect(bookmarks.map((node) => node.title)).toEqual(['Chapter 1', 'Cover'])

    const deleteTarget = bookmarks[1]!.children![0]!.id
    const deleted = await deleteBookmarkInBytes(reordered, deleteTarget)
    bookmarks = await listBookmarksFromBytes(deleted)
    expect(bookmarks[1]?.children ?? []).toHaveLength(0)
    expect(bookmarks.some((node) => node.id === deleteTarget)).toBe(false)
  })

  it('rejects moving a bookmark into its descendant', async () => {
    const empty = await createBlankPdf(2)
    const parent = await createBookmarkInBytes(empty, 0, 'Parent')
    const child = await createBookmarkInBytes(parent.bytes, 1, 'Child', parent.bookmarkId)
    await expect(
      moveBookmarkInBytes(child.bytes, parent.bookmarkId, child.bookmarkId, 0),
    ).rejects.toThrow(/descendant/i)
  })

  it('lists existing outline items written at a low level', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([100, 100])
    const outlinesRef = pdf.context.nextRef()
    const itemRef = pdf.context.nextRef()

    const item = pdf.context.obj({
      Title: PDFHexString.fromText('Intro'),
      Parent: outlinesRef,
      Dest: [page.ref, 'XYZ', null, null, null],
    })
    pdf.context.assign(itemRef, item)

    const outlines = pdf.context.obj({
      Type: 'Outlines',
      First: itemRef,
      Last: itemRef,
      Count: 1,
    })
    pdf.context.assign(outlinesRef, outlines)
    pdf.catalog.set(PDFName.of('Outlines'), outlinesRef)

    const bytes = await pdf.save({ useObjectStreams: false })
    const bookmarks = await listBookmarksFromBytes(bytes)
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0]?.title).toBe('Intro')
    expect(bookmarks[0]?.pageIndex).toBe(0)
    expect(bookmarks[0]?.id).toBe(String((itemRef as PDFRef).objectNumber))
  })
})
