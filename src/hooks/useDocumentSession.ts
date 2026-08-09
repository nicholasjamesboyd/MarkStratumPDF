import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DocumentInfo,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
} from '../../shared/ipc'

export function useDocumentSession() {
  const [document, setDocument] = useState<DocumentInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passwordPromptPath, setPasswordPromptPath] = useState<string | null>(null)
  const objectUrls = useRef(new Map<string, string>())

  const revokeAllUrls = useCallback(() => {
    for (const url of objectUrls.current.values()) {
      URL.revokeObjectURL(url)
    }
    objectUrls.current.clear()
  }, [])

  const applyOpenResult = useCallback(
    (result: OpenDocumentResult) => {
      if (result.ok) {
        revokeAllUrls()
        setDocument(result.document)
        setPasswordPromptPath(null)
        setError(null)
        return
      }
      if ('needsPassword' in result && result.needsPassword) {
        setPasswordPromptPath(result.path)
        setError(null)
        return
      }
      if ('error' in result) {
        setError(result.error)
      }
    },
    [revokeAllUrls],
  )

  const openPath = useCallback(
    async (filePath: string, password?: string) => {
      setBusy(true)
      setError(null)
      try {
        const result = await window.redColumn.openPath(filePath, password)
        applyOpenResult(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [applyOpenResult],
  )

  const openDialog = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.redColumn.openDialog()
      if (!result) {
        return
      }
      applyOpenResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [applyOpenResult])

  const submitPassword = useCallback(
    async (password: string) => {
      if (!passwordPromptPath) {
        return
      }
      await openPath(passwordPromptPath, password)
    },
    [openPath, passwordPromptPath],
  )

  const closeDocument = useCallback(async () => {
    await window.redColumn.closeDocument()
    revokeAllUrls()
    setDocument(null)
    setError(null)
  }, [revokeAllUrls])

  const renderPageToUrl = useCallback(async (req: RenderPageRequest): Promise<{
    url: string
    width: number
    height: number
    scale: number
  }> => {
    const rendered: RenderedPage = await window.redColumn.renderPage(req)
    const cacheKey = `${rendered.pageIndex}:${Math.round(rendered.scale * 1000)}`
    const source =
      rendered.data instanceof Uint8Array
        ? rendered.data
        : new Uint8Array(rendered.data as ArrayLike<number>)
    const bytes = new Uint8Array(source.byteLength)
    bytes.set(source)
    const blob = new Blob([bytes], { type: rendered.mimeType })
    const url = URL.createObjectURL(blob)
    const previous = objectUrls.current.get(cacheKey)
    if (previous) {
      URL.revokeObjectURL(previous)
    }
    objectUrls.current.set(cacheKey, url)
    return {
      url,
      width: rendered.width,
      height: rendered.height,
      scale: rendered.scale,
    }
  }, [])

  useEffect(() => {
    return () => {
      revokeAllUrls()
    }
  }, [revokeAllUrls])

  return {
    document,
    busy,
    error,
    setError,
    passwordPromptPath,
    setPasswordPromptPath,
    openPath,
    openDialog,
    submitPassword,
    closeDocument,
    renderPageToUrl,
  }
}
