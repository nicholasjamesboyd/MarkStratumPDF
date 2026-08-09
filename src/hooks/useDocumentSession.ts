import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DocumentInfo,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
} from '../../shared/ipc'

export function useDocumentSession() {
  const [pdfDocument, setPdfDocument] = useState<DocumentInfo | null>(null)
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
        setPdfDocument(result.document)
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
        const result = await window.markStratum.openPath(filePath, password)
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
      const result = await window.markStratum.openDialog()
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
    await window.markStratum.closeDocument()
    revokeAllUrls()
    setPdfDocument(null)
    setError(null)
  }, [revokeAllUrls])

  const renderPageToUrl = useCallback(async (req: RenderPageRequest): Promise<{
    url: string
    width: number
    height: number
    scale: number
  }> => {
    const rendered: RenderedPage = await window.markStratum.renderPage(req)
    if (!rendered.dataBase64) {
      throw new Error('Render returned empty image data')
    }
    const bytes = base64ToUint8Array(rendered.dataBase64)
    const cacheKey = `${rendered.pageIndex}:${Math.round(rendered.scale * 1000)}`
    const blob = new Blob([Uint8Array.from(bytes)], { type: rendered.mimeType })
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
    document: pdfDocument,
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

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
