import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'
import type { ViewMode } from '../../shared/ipc'
import { IpcChannels } from '../../shared/ipc'

export function buildAppMenu(getWindow: () => BrowserWindow | null): Menu {
  const send = (channel: string, ...args: unknown[]) => {
    const win = getWindow()
    win?.webContents.send(channel, ...args)
  }

  const openPdfDialog = async () => {
    const win = getWindow()
    if (!win) {
      return
    }
    const result = await dialog.showOpenDialog(win, {
      title: 'Open PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return
    }
    win.webContents.send('app:open-path', result.filePaths[0])
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
            void openPdfDialog()
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
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
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
