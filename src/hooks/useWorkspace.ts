import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DocumentInfo,
  FormFieldInfo,
  FormValueUpdate,
  OpenDocumentResult,
  RenderedPage,
  RenderPageRequest,
  ViewMode,
} from '../../shared/ipc'

export type TabState = {
  id: string
  document: DocumentInfo
  pageIndex: number
  scale: number
  viewMode: ViewMode
  formFields: FormFieldInfo[]
  formRevision: number
}

export type WorkspaceLayout =
  | { mode: 'single'; tabId: string }
  | {
      mode: 'split'
      direction: 'horizontal'
      panes: [string, string]
      sizes: [number, number]
    }

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

type UseWorkspaceOptions = {
  onDocumentOpened?: (filePath: string) => void
}

export function useWorkspace(options: UseWorkspaceOptions = {}) {
  const { onDocumentOpened } = options
  const onDocumentOpenedRef = useRef(onDocumentOpened)
  onDocumentOpenedRef.current = onDocumentOpened

  const [tabs, setTabs] = useState<TabState[]>([])
  const [layout, setLayout] = useState<WorkspaceLayout | null>(null)
  const [focusedPane, setFocusedPane] = useState<0 | 1>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passwordPromptPath, setPasswordPromptPath] = useState<string | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const focusedTabId = useMemo(() => {
    if (!layout) {
      return null
    }
    if (layout.mode === 'single') {
      return layout.tabId
    }
    return layout.panes[focusedPane]
  }, [focusedPane, layout])

  const focusedTab = useMemo(
    () => tabs.find((tab) => tab.id === focusedTabId) ?? null,
    [focusedTabId, tabs],
  )

  const activateTabInFocusedPane = useCallback((tabId: string) => {
    setLayout((prev) => {
      if (!prev) {
        return { mode: 'single', tabId }
      }
      if (prev.mode === 'single') {
        return { mode: 'single', tabId }
      }
      const otherPane = focusedPane === 0 ? 1 : 0
      if (prev.panes[otherPane] === tabId) {
        return {
          ...prev,
          panes: [prev.panes[1], prev.panes[0]],
        }
      }
      if (prev.panes[focusedPane] === tabId) {
        return prev
      }
      const panes: [string, string] = [...prev.panes]
      panes[focusedPane] = tabId
      return { ...prev, panes }
    })
  }, [focusedPane])

  const loadFormFields = useCallback(async (documentId: string, bumpRevision = false) => {
    try {
      const fields = await window.markStratum.getFormFields(documentId)
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === documentId
            ? {
                ...tab,
                formFields: fields,
                formRevision: bumpRevision ? tab.formRevision + 1 : tab.formRevision,
              }
            : tab,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const addOrFocusDocument = useCallback(
    (document: DocumentInfo) => {
      setPasswordPromptPath(null)
      setError(null)
      onDocumentOpenedRef.current?.(document.path)
      const existing = tabsRef.current.find(
        (tab) => normalizePath(tab.document.path) === normalizePath(document.path),
      )
      if (existing) {
        activateTabInFocusedPane(existing.id)
        return
      }
      const next: TabState = {
        id: document.documentId,
        document,
        pageIndex: 0,
        scale: 1,
        viewMode: 'document',
        formFields: [],
        formRevision: 0,
      }
      setTabs((prev) => [...prev, next])
      setLayout((current) => {
        if (!current || current.mode === 'single') {
          return { mode: 'single', tabId: next.id }
        }
        const panes: [string, string] = [...current.panes]
        panes[focusedPane] = next.id
        return { ...current, panes }
      })
      void loadFormFields(document.documentId)
    },
    [activateTabInFocusedPane, focusedPane, loadFormFields],
  )

  const applyOpenResult = useCallback(
    (result: OpenDocumentResult) => {
      if (result.ok) {
        addOrFocusDocument(result.document)
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
    [addOrFocusDocument],
  )

  const openPath = useCallback(
    async (filePath: string, password?: string) => {
      const existing = tabsRef.current.find(
        (tab) => normalizePath(tab.document.path) === normalizePath(filePath),
      )
      if (existing && !password) {
        onDocumentOpenedRef.current?.(filePath)
        activateTabInFocusedPane(existing.id)
        return
      }
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
    [activateTabInFocusedPane, applyOpenResult],
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

  const updateTab = useCallback((tabId: string, patch: Partial<Omit<TabState, 'id' | 'document'>>) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
    )
  }, [])

  const applyDocumentInfo = useCallback((document: DocumentInfo) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === document.documentId ? { ...tab, document } : tab,
      ),
    )
    onDocumentOpenedRef.current?.(document.path)
  }, [])

  const refreshAfterSave = useCallback(
    async (document: DocumentInfo) => {
      applyDocumentInfo(document)
      await loadFormFields(document.documentId, true)
    },
    [applyDocumentInfo, loadFormFields],
  )

  const setFormValuesForDocument = useCallback(
    async (documentId: string, updates: FormValueUpdate[]) => {
      if (updates.length === 0) {
        return
      }
      try {
        const result = await window.markStratum.setFormValues(documentId, updates)
        if (!result.ok) {
          setError(result.error)
          return
        }
        applyDocumentInfo(result.document)
        const fields = await window.markStratum.getFormFields(documentId)
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === documentId ? { ...tab, formFields: fields } : tab,
          ),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [applyDocumentInfo],
  )

  const saveFocusedDocument = useCallback(async () => {
    const tab = tabsRef.current.find((entry) => entry.id === focusedTabId)
    if (!tab) {
      setError('Open a PDF before saving.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.markStratum.saveDocument(tab.document.documentId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      await refreshAfterSave(result.document)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [focusedTabId, refreshAfterSave])

  const saveFocusedDocumentAs = useCallback(async () => {
    const tab = tabsRef.current.find((entry) => entry.id === focusedTabId)
    if (!tab) {
      setError('Open a PDF before saving.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.markStratum.saveDocumentAs(tab.document.documentId)
      if (!result) {
        return
      }
      if (!result.ok) {
        setError(result.error)
        return
      }
      await refreshAfterSave(result.document)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [focusedTabId, refreshAfterSave])

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev
      }
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const closeTab = useCallback(async (tabId: string) => {
    await window.markStratum.closeDocument(tabId)
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === tabId)
      if (index < 0) {
        return prev
      }
      const next = prev.filter((tab) => tab.id !== tabId)
      setLayout((current) => {
        if (!current) {
          return null
        }
        if (current.mode === 'single') {
          if (current.tabId !== tabId) {
            return current
          }
          if (next.length === 0) {
            return null
          }
          const neighbor = next[Math.min(index, next.length - 1)]
          return { mode: 'single', tabId: neighbor.id }
        }

        const otherPane = current.panes[0] === tabId ? current.panes[1] : current.panes[0]
        if (current.panes[0] !== tabId && current.panes[1] !== tabId) {
          return current
        }
        if (next.length === 0) {
          return null
        }
        if (otherPane !== tabId && next.some((tab) => tab.id === otherPane)) {
          setFocusedPane(0)
          return { mode: 'single', tabId: otherPane }
        }
        const neighbor = next[Math.min(index, next.length - 1)]
        setFocusedPane(0)
        return { mode: 'single', tabId: neighbor.id }
      })
      return next
    })
    setPasswordPromptPath(null)
    setError(null)
  }, [])

  const closeFocusedTab = useCallback(async () => {
    if (!focusedTabId) {
      return
    }
    await closeTab(focusedTabId)
  }, [closeTab, focusedTabId])

  const toggleSplit = useCallback(() => {
    setLayout((current) => {
      const list = tabsRef.current
      if (!current || list.length < 2) {
        return current
      }
      if (current.mode === 'split') {
        const keepId = current.panes[focusedPane]
        setFocusedPane(0)
        return { mode: 'single', tabId: keepId }
      }
      const activeIndex = list.findIndex((tab) => tab.id === current.tabId)
      const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % list.length : 1
      const secondary = list[nextIndex]
      if (!secondary || secondary.id === current.tabId) {
        return current
      }
      setFocusedPane(0)
      return {
        mode: 'split',
        direction: 'horizontal',
        panes: [current.tabId, secondary.id],
        sizes: [0.5, 0.5],
      }
    })
  }, [focusedPane])

  const setSplitSizes = useCallback((sizes: [number, number]) => {
    setLayout((current) => {
      if (!current || current.mode !== 'split') {
        return current
      }
      return { ...current, sizes }
    })
  }, [])

  const renderPageToUrl = useCallback(async (req: RenderPageRequest): Promise<{
    url: string
    width: number
    height: number
    scale: number
  }> => {
    const rendered: RenderedPage = await window.markStratum.renderPage(req)
    if (!rendered?.dataBase64) {
      throw new Error('Render returned empty image data')
    }
    return {
      url: `data:${rendered.mimeType};base64,${rendered.dataBase64}`,
      width: rendered.width,
      height: rendered.height,
      scale: rendered.scale,
    }
  }, [])

  useEffect(() => {
    if (!window.markStratum) {
      setError('MarkStratum preload API failed to load. Restart the app.')
    }
  }, [])

  return {
    tabs,
    layout,
    focusedPane,
    focusedTab,
    focusedTabId,
    busy,
    error,
    setError,
    passwordPromptPath,
    setPasswordPromptPath,
    openPath,
    openDialog,
    submitPassword,
    applyOpenResult,
    activateTabInFocusedPane,
    updateTab,
    reorderTabs,
    closeTab,
    closeFocusedTab,
    saveFocusedDocument,
    saveFocusedDocumentAs,
    setFormValuesForDocument,
    toggleSplit,
    setSplitSizes,
    setFocusedPane,
    renderPageToUrl,
  }
}
