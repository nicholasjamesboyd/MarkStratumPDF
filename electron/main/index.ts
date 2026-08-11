import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import {
  IpcChannels,
  type FormValueUpdate,
  type OpenDocumentResult,
  type RenderPageRequest,
  type SaveDocumentResult,
} from '../../shared/ipc'
import { concurrency } from 'pdfium-native'
import { DocumentSession } from './pdf/documentSession'
import { buildAppMenu } from './menu'

// Serialize native PDFium work in the Electron main process.
concurrency(1)

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

if (process.platform === 'win32' && os.release().startsWith('6.1')) {
  app.disableHardwareAcceleration()
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.markstratum.pdf')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const session = new DocumentSession()
const preloadCandidates = [
  path.join(__dirname, '../preload/index.cjs'),
  path.join(__dirname, '../preload/index.js'),
  path.join(__dirname, '../preload/index.mjs'),
]
const preload = preloadCandidates.find((candidate) => existsSync(candidate)) ?? preloadCandidates[0]
const indexHtml = path.join(RENDERER_DIST, 'index.html')
let pendingOpenPath: string | undefined
let rendererReady = false

function findPdfArg(argv: string[]): string | undefined {
  // Skip the executable and Electron/Chromium flags; prefer the last PDF path.
  const candidates = argv.filter((arg, index) => {
    if (index === 0) {
      return false
    }
    if (arg.startsWith('-')) {
      return false
    }
    return arg.toLowerCase().endsWith('.pdf')
  })
  return candidates.at(-1)
}

function queueOpenPath(filePath: string) {
  if (rendererReady && win && !win.isDestroyed()) {
    win.webContents.send('app:open-path', filePath)
    return
  }
  pendingOpenPath = filePath
}

function notifyOpenResult(result: OpenDocumentResult) {
  win?.webContents.send('app:open-result', result)
}

async function openPdfWithDialog(parent: BrowserWindow): Promise<void> {
  const picked = await dialog.showOpenDialog(parent, {
    title: 'Open PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (picked.canceled || picked.filePaths.length === 0) {
    return
  }
  const result = await session.open(picked.filePaths[0])
  notifyOpenResult(result)
}

async function createWindow() {
  win = new BrowserWindow({
    title: 'MarkStratum',
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0f1114',
    icon: path.join(process.env.VITE_PUBLIC!, 'icon-256.png'),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  Menu.setApplicationMenu(buildAppMenu(() => win, openPdfWithDialog))

  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.key === 'Escape' &&
      !input.control &&
      !input.meta &&
      !input.alt &&
      !input.shift &&
      win?.isFullScreen()
    ) {
      win.setFullScreen(false)
      event.preventDefault()
    }
  })

  rendererReady = false

  if (VITE_DEV_SERVER_URL) {
    await win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(indexHtml)
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.on('closed', () => {
    rendererReady = false
    win = null
  })
}

function registerIpc() {
  ipcMain.handle(
    IpcChannels.openPath,
    async (_event, filePath: string, password?: string): Promise<OpenDocumentResult> => {
      return session.open(filePath, password)
    },
  )

  ipcMain.handle(
    IpcChannels.openDialog,
    async (event): Promise<OpenDocumentResult | null> => {
      const parent =
        BrowserWindow.fromWebContents(event.sender) ?? win ?? BrowserWindow.getFocusedWindow()
      if (!parent) {
        return { ok: false, error: 'No window available for the open dialog.' }
      }
      const picked = await dialog.showOpenDialog(parent, {
        title: 'Open PDF',
        properties: ['openFile'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (picked.canceled || picked.filePaths.length === 0) {
        return null
      }
      return session.open(picked.filePaths[0])
    },
  )

  ipcMain.handle(IpcChannels.close, async (_event, documentId?: string) => {
    await session.close(documentId)
  })

  ipcMain.handle(IpcChannels.renderPage, async (_event, req: RenderPageRequest) => {
    return session.renderPage(req)
  })

  ipcMain.handle(IpcChannels.getBookmarks, async (_event, documentId: string) => {
    return session.getBookmarks(documentId)
  })

  ipcMain.handle(IpcChannels.getFormFields, async (_event, documentId: string) => {
    return session.getFormFields(documentId)
  })

  ipcMain.handle(
    IpcChannels.setFormValues,
    async (_event, documentId: string, updates: FormValueUpdate[]) => {
      return session.setFormValues(documentId, updates)
    },
  )

  ipcMain.handle(IpcChannels.save, async (_event, documentId: string): Promise<SaveDocumentResult> => {
    return session.save(documentId)
  })

  ipcMain.handle(
    IpcChannels.saveAs,
    async (event, documentId: string): Promise<SaveDocumentResult | null> => {
      const entry = session.getDocument(documentId)
      if (!entry) {
        return { ok: false, error: 'No document open to save.' }
      }
      const parent =
        BrowserWindow.fromWebContents(event.sender) ?? win ?? BrowserWindow.getFocusedWindow()
      if (!parent) {
        return { ok: false, error: 'No window available for the save dialog.' }
      }
      const picked = await dialog.showSaveDialog(parent, {
        title: 'Save As',
        defaultPath: entry.path,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (picked.canceled || !picked.filePath) {
        return null
      }
      const destPath = picked.filePath.toLowerCase().endsWith('.pdf')
        ? picked.filePath
        : `${picked.filePath}.pdf`
      return session.saveAs(documentId, destPath)
    },
  )

  ipcMain.handle(IpcChannels.takePendingOpenPath, (): string | null => {
    rendererReady = true
    const filePath = pendingOpenPath
    pendingOpenPath = undefined
    return filePath ?? null
  })
}

app.whenReady().then(async () => {
  registerIpc()
  await createWindow()
})

app.on('window-all-closed', () => {
  win = null
  void session.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('second-instance', (_event, argv) => {
  const fileArg = findPdfArg(argv)
  if (win) {
    if (win.isMinimized()) {
      win.restore()
    }
    win.focus()
  }
  if (fileArg) {
    queueOpenPath(fileArg)
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})

// macOS: double-clicked / Open With files arrive here, sometimes before ready.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (filePath.toLowerCase().endsWith('.pdf')) {
    queueOpenPath(filePath)
  }
})

const openFromArgv = findPdfArg(process.argv)
if (openFromArgv) {
  pendingOpenPath = openFromArgv
}
