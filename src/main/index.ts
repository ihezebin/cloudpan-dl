import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { availableParallelism } from 'node:os'
import Store from 'electron-store'
import type {
  AppSettings,
  CloudFile,
  DownloadRequest,
  ParseRequest,
  Provider
} from '../shared/types'
import { DownloadManager } from './downloads'
import { cloudSession, isLoggedIn, listFolder, parseShare, providerConfig } from './providers'

const maxConcurrency = availableParallelism()
const defaultConcurrency = Math.max(1, Math.round(maxConcurrency * 0.6))

const store = new Store<AppSettings>({
  defaults: {
    defaultDownloadPath: '',
    concurrency: defaultConcurrency,
    maxConcurrency,
    theme: 'system',
    font: 'lxgw_wenkai'
  }
})
let mainWindow: BrowserWindow | null = null
let downloads: DownloadManager

function settings(): AppSettings {
  const storedFont = store.get('font') as string
  return {
    defaultDownloadPath: store.get('defaultDownloadPath') || app.getPath('downloads'),
    concurrency: store.get('concurrency'),
    maxConcurrency,
    theme: store.get('theme'),
    font: ['zhuque_fangsong', 'lxgw_wenkai', 'xiaolai'].includes(storedFont)
      ? (storedFont as AppSettings['font'])
      : 'lxgw_wenkai'
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    show: false,
    title: '云盘提速下载器',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

async function login(provider: Provider) {
  const config = providerConfig[provider]
  const loginWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    parent: mainWindow || undefined,
    title: `登录${config.label}`,
    autoHideMenuBar: true,
    webPreferences: {
      session: cloudSession(provider),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  await loginWindow.loadURL(config.loginUrl)
  return await new Promise<{ provider: Provider; loggedIn: boolean; label: string }>((resolve) => {
    let settled = false
    const finish = async () => {
      if (settled) return
      settled = true
      resolve({ provider, loggedIn: await isLoggedIn(provider), label: config.label })
    }
    loginWindow.on('closed', finish)
    const timer = setInterval(async () => {
      if (loginWindow.isDestroyed()) {
        clearInterval(timer)
        return
      }
      if (await isLoggedIn(provider)) {
        clearInterval(timer)
        setTimeout(() => {
          if (!loginWindow.isDestroyed()) loginWindow.close()
        }, 800)
        await finish()
      }
    }, 1200)
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  downloads = new DownloadManager(() => mainWindow, settings)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('cloud:parse', (_event, input: ParseRequest) => parseShare(input))
ipcMain.handle('cloud:list-folder', (_event, provider: Provider, folder: CloudFile) =>
  listFolder(provider, folder)
)
ipcMain.handle('cloud:login', (_event, provider: Provider) => login(provider))
ipcMain.handle('cloud:auth-states', async () =>
  Promise.all(
    (Object.keys(providerConfig) as Provider[]).map(async (provider) => ({
      provider,
      loggedIn: await isLoggedIn(provider),
      label: providerConfig[provider].label
    }))
  )
)
ipcMain.handle('downloads:add', (_event, items: DownloadRequest[]) => downloads.add(items))
ipcMain.handle('downloads:list', () => downloads.list())
ipcMain.handle(
  'downloads:action',
  (_event, id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'delete') =>
    downloads.action(id, action)
)
ipcMain.handle('settings:get', () => settings())
ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
  if (patch.defaultDownloadPath) store.set('defaultDownloadPath', patch.defaultDownloadPath)
  if (patch.concurrency && patch.concurrency >= 1 && patch.concurrency <= maxConcurrency)
    store.set('concurrency', patch.concurrency)
  if (patch.theme && ['system', 'light', 'dark'].includes(patch.theme)) {
    store.set('theme', patch.theme)
    nativeTheme.themeSource = patch.theme
  }
  if (patch.font && ['zhuque_fangsong', 'lxgw_wenkai', 'xiaolai'].includes(patch.font)) {
    store.set('font', patch.font)
  }
  return settings()
})
ipcMain.handle('settings:select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: settings().defaultDownloadPath
  })
  return result.canceled ? null : result.filePaths[0]
})
