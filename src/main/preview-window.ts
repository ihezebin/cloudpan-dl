import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import { registerPdfPreview } from './preview-pdf'
import type { DownloadRequest } from '../shared/types'

export function registerPreviewWindows() {
  const requests = new Map<number, DownloadRequest>()
  registerPdfPreview((owner) => requests.get(owner))
  const windows = new Map<string, BrowserWindow>()
  ipcMain.handle('preview:window-request', (event) => requests.get(event.sender.id) || null)
  ipcMain.handle('preview:window-open', async (_event, request: DownloadRequest) => {
    if (request.file.isFolder) throw new Error('请选择文件进行预览')
    const key = `${request.provider}:${request.file.meta?.shortCode || request.file.meta?.shareId || request.shareUrl}:${request.file.id}`
    const existing = windows.get(key)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return
    }
    const window = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 680,
      minHeight: 480,
      show: false,
      title: request.file.name,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f5f5f5',
      autoHideMenuBar: true,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 22 } }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true
      }
    })
    const id = window.webContents.id
    windows.set(key, window)
    requests.set(id, request)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.on('closed', () => {
      requests.delete(id)
      if (windows.get(key) === window) windows.delete(key)
    })
    window.once('ready-to-show', () => window.show())
    try {
      if (process.env.ELECTRON_RENDERER_URL) {
        const url = new URL(process.env.ELECTRON_RENDERER_URL)
        url.hash = 'preview'
        await window.loadURL(url.toString())
      } else await window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'preview' })
    } catch (error) {
      window.destroy()
      throw error
    }
  })
}
