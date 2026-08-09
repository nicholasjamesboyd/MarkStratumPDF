import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import {
  IpcChannels,
  type OpenDocumentResult,
  type RenderPageRequest,
} from '../../shared/ipc'
import { DocumentSession } from './pdf/documentSession'
import { buildAppMenu } from './menu'

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
  app.setAppUserModelId('com.redcolumn.pdf')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const session = new DocumentSession()
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')
let pendingOpenPath: string | undefined

async function createWindow() {
  win = new BrowserWindow({
    title: 'RedColumn',
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    icon: path.join(process.env.VITE_PUBLIC!, 'favicon.ico'),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  Menu.setApplicationMenu(buildAppMenu(() => win))

  if (VITE_DEV_SERVER_URL) {
    await win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    await win.loadFile(indexHtml)
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      const filePath = pendingOpenPath
      pendingOpenPath = undefined
      win?.webContents.send('app:open-path', filePath)
    }
  })
}

function registerIpc() {
  ipcMain.handle(
    IpcChannels.openPath,
    async (_event, filePath: string, password?: string): Promise<OpenDocumentResult> => {
      return session.open(filePath, password)
    },
  )

  ipcMain.handle(IpcChannels.openDialog, async (): Promise<OpenDocumentResult | null> => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return session.open(result.filePaths[0])
  })

  ipcMain.handle(IpcChannels.close, async () => {
    await session.close()
  })

  ipcMain.handle(IpcChannels.renderPage, async (_event, req: RenderPageRequest) => {
    const rendered = await session.renderPage(req)
    return {
      ...rendered,
      data: Buffer.from(rendered.data),
    }
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
  const fileArg = argv.find((arg) => arg.toLowerCase().endsWith('.pdf'))
  if (win) {
    if (win.isMinimized()) {
      win.restore()
    }
    win.focus()
    if (fileArg) {
      win.webContents.send('app:open-path', fileArg)
    }
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})

const openFromArgv = process.argv.find((arg) => arg.toLowerCase().endsWith('.pdf'))
if (openFromArgv) {
  pendingOpenPath = openFromArgv
}
