import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { ViewMode } from '../../shared/ipc'
import { IpcChannels } from '../../shared/ipc'

type OpenPdfHandler = (win: BrowserWindow) => Promise<void>

export function buildAppMenu(
  getWindow: () => BrowserWindow | null,
  openPdf: OpenPdfHandler,
): Menu {
  const send = (channel: string, ...args: unknown[]) => {
    const win = getWindow()
    win?.webContents.send(channel, ...args)
  }

  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = getWindow()
            if (!win) {
              return
            }
            void openPdf(win)
          },
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(IpcChannels.menuSave),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send(IpcChannels.menuSaveAs),
        },
        {
          label: 'Close',
          accelerator: 'CmdOrCtrl+W',
          click: () => send(IpcChannels.menuClose),
        },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              { role: 'quit' as const },
            ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Document Mode',
          accelerator: 'CmdOrCtrl+1',
          click: () => send(IpcChannels.menuSetViewMode, 'document' satisfies ViewMode),
        },
        {
          label: 'Drawing Mode',
          accelerator: 'CmdOrCtrl+2',
          click: () => send(IpcChannels.menuSetViewMode, 'drawing' satisfies ViewMode),
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => send(IpcChannels.menuZoom, 'in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => send(IpcChannels.menuZoom, 'out'),
        },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => send(IpcChannels.menuZoom, 'actual'),
        },
        {
          label: 'Fit Width',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => send(IpcChannels.menuZoom, 'fitWidth'),
        },
        {
          label: 'Fit Page',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send(IpcChannels.menuZoom, 'fitPage'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Split View',
          accelerator: 'CmdOrCtrl+\\',
          click: () => send(IpcChannels.menuToggleSplit),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => {
            const current = getWindow()
            if (!current) {
              return
            }
            current.setFullScreen(!current.isFullScreen())
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
