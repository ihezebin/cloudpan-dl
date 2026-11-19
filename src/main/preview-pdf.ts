import { BrowserWindow, ipcMain, WebContentsView, app } from 'electron'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DOCUMENT_PREVIEW_LIMIT } from '../shared/preview'
import type { DownloadRequest } from '../shared/types'

type Bounds = { x: number; y: number; width: number; height: number }

// A browser view gives Chromium's PDF reader its own top-level document,
// avoiding the blob iframe/plugin restrictions of the application renderer.
export function registerPdfPreview(requestFor: (owner: number) => DownloadRequest | undefined) {
  const views = new Map<
    number,
    { window: BrowserWindow; view: WebContentsView; directory: string; cancelled: boolean }
  >()
  const generations = new Map<number, number>()
  function close(owner: number) {
    generations.set(owner, (generations.get(owner) || 0) + 1)
    const entry = views.get(owner)
    if (!entry) return
    views.delete(owner)
    entry.cancelled = true
    if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(entry.view)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    void rm(entry.directory, { recursive: true, force: true })
  }
  function bounds(value: Bounds): Bounds {
    if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite))
      throw new Error('PDF 视图尺寸无效')
    return {
      x: Math.max(0, Math.round(value.x)),
      y: Math.max(0, Math.round(value.y)),
      width: Math.max(1, Math.round(value.width)),
      height: Math.max(1, Math.round(value.height))
    }
  }
  ipcMain.handle('preview:pdf-show', async (event, bytes: ArrayBuffer, rect: Bounds) => {
    const owner = event.sender.id
    const request = requestFor(owner)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !request?.file.name.toLowerCase().endsWith('.pdf'))
      throw new Error('PDF 预览窗口已关闭')
    if (
      !(bytes instanceof ArrayBuffer) ||
      bytes.byteLength > DOCUMENT_PREVIEW_LIMIT ||
      !Buffer.from(bytes).subarray(0, 1024).includes(Buffer.from('%PDF-'))
    )
      throw new Error('网盘未返回有效的 PDF 文件，请重试或下载后打开')
    close(owner)
    const generation = generations.get(owner)
    const directory = await mkdtemp(join(app.getPath('temp'), 'cloudpan-pdf-'))
    if (window.isDestroyed() || generation !== generations.get(owner)) {
      await rm(directory, { recursive: true, force: true })
      return
    }
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true
      }
    })
    const entry = { window, view, directory, cancelled: false }
    views.set(owner, entry)
    const cleanup = () => close(owner)
    event.sender.once('destroyed', cleanup)
    view.webContents.once('destroyed', () => {
      if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', cleanup)
    })
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      const path = join(directory, 'document.pdf')
      await writeFile(path, Buffer.from(bytes), { mode: 0o600 })
      if (entry.cancelled) {
        await rm(directory, { recursive: true, force: true })
        return
      }
      view.setBounds(bounds(rect))
      window.contentView.addChildView(view)
      await view.webContents.loadFile(path)
    } catch (error) {
      if (views.get(owner) === entry) close(owner)
      throw error
    }
  })
  ipcMain.on('preview:pdf-bounds', (event, rect: Bounds) => {
    const entry = views.get(event.sender.id)
    if (entry && !entry.view.webContents.isDestroyed()) entry.view.setBounds(bounds(rect))
  })
  ipcMain.on('preview:pdf-close', (event) => close(event.sender.id))
}
