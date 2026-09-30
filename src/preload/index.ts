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
  parse: (input: ParseRequest) => ipcRenderer.invoke('cloud:parse', input),
  listFolder: (provider, folder) => ipcRenderer.invoke('cloud:list-folder', provider, folder),
  login: (provider: Provider) => ipcRenderer.invoke('cloud:login', provider),
  openPage: (provider: Provider) => ipcRenderer.invoke('cloud:open-page', provider),
  logout: (provider: Provider) => ipcRenderer.invoke('cloud:logout', provider),
  authStates: () => ipcRenderer.invoke('cloud:auth-states'),
  addDownloads: (items: DownloadRequest[]) => ipcRenderer.invoke('downloads:add', items),
  taskAction: (id, action) => ipcRenderer.invoke('downloads:action', id, action),
  getTasks: () => ipcRenderer.invoke('downloads:list'),
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
