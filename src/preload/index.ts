import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CloudPanAPI,
  DownloadRequest,
  DownloadTask,
  ParseRequest,
  Provider
} from '../shared/types'

const api: CloudPanAPI = {
  platform: process.platform,
  showPdfPreview: (bytes, bounds) => ipcRenderer.invoke('preview:pdf-show', bytes, bounds),
  resizePdfPreview: (bounds) => ipcRenderer.send('preview:pdf-bounds', bounds),
  closePdfPreview: () => ipcRenderer.send('preview:pdf-close'),
  openPreviewWindow: (request) => ipcRenderer.invoke('preview:window-open', request),
  previewWindowRequest: () => ipcRenderer.invoke('preview:window-request'),
  openPreview: (request) => ipcRenderer.invoke('preview:open', request),
  previewError: (id) => ipcRenderer.invoke('preview:error', id),
  closePreview: (id) => ipcRenderer.invoke('preview:close', id),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },
  parse: (input: ParseRequest) => ipcRenderer.invoke('cloud:parse', input),
  listFolder: (provider, folder) => ipcRenderer.invoke('cloud:list-folder', provider, folder),
  login: (provider: Provider) => ipcRenderer.invoke('cloud:login', provider),
  openPage: (provider: Provider) => ipcRenderer.invoke('cloud:open-page', provider),
  logout: (provider: Provider) => ipcRenderer.invoke('cloud:logout', provider),
  authStates: () => ipcRenderer.invoke('cloud:auth-states'),
  addDownloads: (items: DownloadRequest[]) => ipcRenderer.invoke('downloads:add', items),
  taskAction: (id, action) => ipcRenderer.invoke('downloads:action', id, action),
  getTasks: () => ipcRenderer.invoke('downloads:list'),
  onSettingsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => listener(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', settings),
  selectDirectory: () => ipcRenderer.invoke('settings:select-directory'),
  onTasks: (listener: (tasks: DownloadTask[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tasks: DownloadTask[]) => listener(tasks)
    ipcRenderer.on('downloads:changed', handler)
    return () => ipcRenderer.removeListener('downloads:changed', handler)
  }
}

contextBridge.exposeInMainWorld('cloudPan', api)
