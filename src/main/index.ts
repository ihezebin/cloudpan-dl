import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { availableParallelism } from 'node:os'
import Store from 'electron-store'
import type {
  AppSettings,
  AuthState,
  CloudFile,
  DownloadRequest,
  ParseRequest,
  Provider
} from '../shared/types'
import { DownloadManager } from './downloads'
import {
  clearBaiduDownloadContext,
  cloudSession,
  hasLoginSession,
  isLoggedIn,
  listFolder,
  parseShare,
  persistLoginCookies,
  providerConfig
} from './providers'

const maxConcurrency = availableParallelism()
const defaultConcurrency = Math.max(1, Math.round(maxConcurrency * 0.6))

const store = new Store<AppSettings>({
  defaults: {
    defaultDownloadPath: '',
    concurrency: defaultConcurrency,
    maxConcurrency,
    theme: 'system',
    font: 'xiaolai'
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
      : 'xiaolai'
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
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } }
      : {}),
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
  return await new Promise<AuthState>((resolve) => {
    let settled = false
    let checking = false
    const finish = async () => {
      if (settled) return
      settled = true
      const loggedIn = await isLoggedIn(provider)
      if (loggedIn) await persistLoginCookies(provider)
      resolve({
        provider,
        loggedIn,
        hasSession: await hasLoginSession(provider),
        label: config.label
      })
    }
    loginWindow.on('closed', finish)
    const timer = setInterval(async () => {
      if (loginWindow.isDestroyed() || settled) {
        clearInterval(timer)
        return
      }
      if (checking) return
      checking = true
      try {
        if (await isLoggedIn(provider)) {
          clearInterval(timer)
          setTimeout(() => {
            if (!loginWindow.isDestroyed()) loginWindow.close()
          }, 800)
          await finish()
        }
      } finally {
        checking = false
      }
    }, 1200)
  })
}

async function openProviderPage(provider: Provider): Promise<AuthState> {
  const config = providerConfig[provider]
  if (!config) throw new Error('不支持的网盘平台')
  const pageWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    parent: mainWindow || undefined,
    title: config.label,
    autoHideMenuBar: true,
    webPreferences: {
      session: cloudSession(provider),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  await pageWindow.loadURL(config.loginUrl)
  return new Promise<AuthState>((resolve) => {
    pageWindow.on('closed', async () => {
      const loggedIn = await isLoggedIn(provider)
      if (loggedIn) await persistLoginCookies(provider)
      resolve({
        provider,
        loggedIn,
        hasSession: await hasLoginSession(provider),
        label: config.label
      })
    })
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
ipcMain.handle('cloud:open-page', (_event, provider: Provider) => openProviderPage(provider))
ipcMain.handle('cloud:logout', async (_event, provider: Provider) => {
  if (!providerConfig[provider]) throw new Error('不支持的网盘平台')
  await cloudSession(provider).clearStorageData()
  await cloudSession(provider).flushStorageData()
  if (provider === 'baidu') clearBaiduDownloadContext()
  return { provider, loggedIn: false, hasSession: false, label: providerConfig[provider].label }
})
ipcMain.handle('cloud:auth-states', async () =>
  Promise.all(
    (Object.keys(providerConfig) as Provider[]).map(async (provider) => ({
      provider,
      loggedIn: await isLoggedIn(provider),
      hasSession: await hasLoginSession(provider),
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
