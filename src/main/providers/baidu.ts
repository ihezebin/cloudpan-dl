import { BrowserWindow } from 'electron'
import type { CloudFile, DownloadRequest, ParseRequest, ParseResult } from '../../shared/types'
import { cloudSession, isLoggedIn, USER_AGENT } from './session'
import type { CloudProviderAdapter } from './types'
import { kindOf, normalizeShareInput } from './utils'

const BAIDU_DOWNLOAD_USER_AGENT =
  'netdisk;P2SP;3.0.0.8;netdisk;11.12.3;ANG-AN00;android-android;10.0;JSbridge4.4.0;jointBridge;1.1.0;'

function balancedArray(text: string, key: string): unknown[] | null {
  const keyAt = text.indexOf(key)
  if (keyAt < 0) return null
  const start = text.indexOf('[', keyAt)
  if (start < 0) return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '[') depth += 1
    else if (char === ']' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function balancedObject(text: string, key: string): Record<string, any> | null {
  const keyAt = text.indexOf(key)
  if (keyAt < 0) return null
  const start = text.indexOf('{', keyAt)
  if (start < 0) return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function shareCode(url: URL): string {
  const pathCode = url.pathname.match(/^\/s\/1([^/?#]+)/)?.[1]
  return pathCode || url.searchParams.get('surl') || ''
}

async function verifyPasscode(code: string, passcode: string): Promise<void> {
  const verifyUrl = new URL('https://pan.baidu.com/share/verify')
  verifyUrl.searchParams.set('surl', code)
  verifyUrl.searchParams.set('t', String(Date.now()))
  verifyUrl.searchParams.set('channel', 'chunlei')
  verifyUrl.searchParams.set('web', '1')
  verifyUrl.searchParams.set('app_id', '250528')
  verifyUrl.searchParams.set('clienttype', '0')

  const response = await cloudSession('baidu').fetch(verifyUrl.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'user-agent': USER_AGENT,
      referer: `https://pan.baidu.com/share/init?surl=${encodeURIComponent(code)}`
    },
    body: new URLSearchParams({ pwd: passcode, vcode: '', vcode_str: '' }).toString()
  })
  const result = (await response.json()) as { errno?: number }
  if (result.errno !== 0) {
    throw new Error('PASSCODE_REQUIRED:提取码不正确，请重新输入')
  }
}

interface BaiduFile {
  fs_id?: number | string
  id?: number | string
  server_filename?: string
  filename?: string
  name?: string
  size?: number
  isdir?: number | boolean | string
  path?: string
}

interface ShareContext {
  shareId: string
  shareUk: string
  shortCode: string
}

function mapFile(item: BaiduFile, context: ShareContext, parentPath = ''): CloudFile {
  const folder = item.isdir === 1 || item.isdir === true || item.isdir === '1'
  const name = item.server_filename || item.filename || item.name || '未命名'
  return {
    id: String(item.fs_id ?? item.id),
    name,
    size: Number(item.size || 0),
    isFolder: folder,
    kind: kindOf(name, folder),
    path: parentPath,
    // Baidu needs the owner's absolute path, not the display path relative to the share.
    meta: { ...context, serverPath: item.path || '' }
  }
}

interface DownloadContext {
  sign: string
  timestamp: number | string
}

const contextCache = new Map<string, { value: DownloadContext; expiresAt: number }>()

export function clearBaiduDownloadContext() {
  contextCache.clear()
}

async function downloadContext(
  shareUrl: string,
  shareId: string,
  shortCode: string
): Promise<DownloadContext> {
  const cached = contextCache.get(shareUrl)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  // The v2 share page no longer exposes window.locals. This endpoint expects
  // the full surl (including its leading 1), unlike /share/verify.
  const query = new URLSearchParams({
    surl: `1${shortCode}`,
    shareid: shareId,
    fields: 'sign,timestamp',
    channel: 'chunlei',
    web: '1',
    app_id: '250528',
    clienttype: '0'
  })
  try {
    const response = await cloudSession('baidu').fetch(
      `https://pan.baidu.com/share/tplconfig?${query}`,
      {
        credentials: 'include',
        signal: AbortSignal.timeout(15000),
        headers: { 'user-agent': USER_AGENT, referer: shareUrl }
      }
    )
    const payload = (await response.json()) as { errno?: number; data?: DownloadContext }
    if (response.ok && payload.errno === 0 && payload.data?.sign && payload.data?.timestamp) {
      const value = { sign: payload.data.sign, timestamp: payload.data.timestamp }
      contextCache.set(shareUrl, { value, expiresAt: Date.now() + 5 * 60 * 1000 })
      return value
    }
  } catch {
    // Older pages can still provide the signature through their page runtime.
  }

  const loginWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      session: cloudSession('baidu'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try {
    await loginWindow.loadURL(shareUrl)
    const value = (await loginWindow.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const startedAt = Date.now()
        const load = () => {
          const modern = window.__DISK_SHARE_V2_LOCALS__
          if (modern && modern.sign && modern.timestamp) {
            resolve({ sign: modern.sign, timestamp: modern.timestamp })
            return
          }
          if (window.locals && typeof window.locals.get === 'function') {
            window.locals.get('sign', 'timestamp', (sign, timestamp) => {
              if (sign && timestamp) resolve({ sign, timestamp })
              else reject(new Error('百度分享页未返回下载签名'))
            })
            return
          }
          if (Date.now() - startedAt > 15000) {
            reject(new Error('等待百度分享页初始化超时'))
            return
          }
          setTimeout(load, 100)
        }
        load()
      })
    `)) as DownloadContext
    contextCache.set(shareUrl, { value, expiresAt: Date.now() + 5 * 60 * 1000 })
    return value
  } finally {
    if (!loginWindow.isDestroyed()) loginWindow.destroy()
  }
}

export class BaiduProvider implements CloudProviderAdapter {
  readonly provider = 'baidu' as const

  downloadHeaders(_request: DownloadRequest) {
    return {
      'user-agent': BAIDU_DOWNLOAD_USER_AGENT,
      referer: 'https://pan.baidu.com/'
    }
  }

  async parse(input: ParseRequest): Promise<ParseResult> {
    const url = new URL(input.url)
    if (input.passcode && !url.searchParams.has('pwd')) url.searchParams.set('pwd', input.passcode)
    let response = await cloudSession('baidu').fetch(url.toString(), {
      headers: { 'user-agent': USER_AGENT, referer: 'https://pan.baidu.com/' }
    })
    let html = await response.text()
    const redirectedUrl = response.url ? new URL(response.url) : null
    const isPasscodePage =
      redirectedUrl?.pathname === '/share/init' ||
      /<title>\s*百度网盘\s+请输入提取码\s*<\/title>/i.test(html)
    if (isPasscodePage) {
      if (!input.passcode) throw new Error('PASSCODE_REQUIRED:该分享需要提取码')
      const code = (redirectedUrl && shareCode(redirectedUrl)) || shareCode(url)
      await verifyPasscode(code, input.passcode)
      response = await cloudSession('baidu').fetch(url.toString(), {
        headers: {
          'user-agent': USER_AGENT,
          referer:
            redirectedUrl?.toString() ||
            `https://pan.baidu.com/share/init?surl=${encodeURIComponent(code)}`
        }
      })
      html = await response.text()
    }
    const shareId = shareCode(url)
    const localsJson = html.match(
      /<script\b[^>]*\bid=["']locals-data["'][^>]*>([\s\S]*?)<\/script>/i
    )?.[1]
    const shareData =
      (localsJson && balancedObject(localsJson, '')) || balancedObject(html, 'locals.mset(')
    const numericShareId = String(shareData?.shareid || '')
    const shareUk = String(shareData?.share_uk || '')
    const raw =
      balancedArray(html, '"file_list":') ||
      balancedArray(html, '"fileList":') ||
      balancedArray(html, '"list":') ||
      []
    const files = (raw as BaiduFile[]).map((item) =>
      mapFile(item, { shareId: numericShareId, shareUk, shortCode: shareId })
    )
    if (!files.length) throw new Error('百度未返回文件列表，请确认分享链接有效')
    const title =
      html
        .match(/<title>([^<]+)/i)?.[1]
        ?.replace(/_免费高速下载\|百度网盘-分享无限制/, '')
        .trim() || '百度网盘分享'
    const requiresLogin = !(await isLoggedIn('baidu'))
    return {
      provider: 'baidu',
      title,
      shareId,
      files,
      requiresLogin,
      notice: requiresLogin ? '下载前请先登录自己的百度网盘账号。' : undefined
    }
  }

  async listFolder(folder: CloudFile): Promise<CloudFile[]> {
    const context: ShareContext = {
      shareId: String(folder.meta?.shareId || ''),
      shareUk: String(folder.meta?.shareUk || ''),
      shortCode: String(folder.meta?.shortCode || '')
    }
    const serverPath = String(folder.meta?.serverPath || '')
    if (
      !folder.isFolder ||
      !context.shareId ||
      !context.shareUk ||
      !context.shortCode ||
      !serverPath
    ) {
      throw new Error('百度文件夹缺少分享参数，请重新解析链接后重试')
    }

    const files: CloudFile[] = []
    const parentPath = folder.path ? `${folder.path}/${folder.name}` : folder.name
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({
        uk: context.shareUk,
        shareid: context.shareId,
        dir: serverPath,
        root: '0',
        page: String(page),
        num: '100',
        order: 'name',
        desc: '0',
        showempty: '0',
        app_id: '250528',
        channel: 'chunlei',
        clienttype: '0',
        web: '1'
      })
      const response = await cloudSession('baidu').fetch(
        `https://pan.baidu.com/share/list?${query}`,
        {
          credentials: 'include',
          signal: AbortSignal.timeout(15000),
          headers: {
            'user-agent': USER_AGENT,
            'x-requested-with': 'XMLHttpRequest',
            referer: `https://pan.baidu.com/s/1${context.shortCode}`
          }
        }
      )
      let payload: {
        errno?: number
        errmsg?: string
        list?: BaiduFile[]
      }
      try {
        payload = await response.json()
      } catch {
        throw new Error(`百度返回了无法识别的目录数据（HTTP ${response.status}），请重新解析链接`)
      }
      if (!response.ok || payload.errno !== 0) {
        if (payload.errno === -9 || payload.errno === 9019) {
          throw new Error('百度分享验证已失效，请重新解析链接并输入提取码')
        }
        if (payload.errno === -6 || payload.errno === 112) {
          throw new Error('百度登录状态已失效，请重新登录后重试')
        }
        throw new Error(
          payload.errmsg || `百度读取文件夹失败（错误码 ${payload.errno ?? response.status}）`
        )
      }
      if (!Array.isArray(payload.list)) throw new Error('百度未返回目录列表，请重新解析链接后重试')
      files.push(...payload.list.map((item) => mapFile(item, context, parentPath)))
      if (payload.list.length < 100) return files
    }
  }

  async resolveDownloadUrl(request: DownloadRequest): Promise<string> {
    const shareId = String(request.file.meta?.shareId || '')
    const shareUk = String(request.file.meta?.shareUk || '')
    const shortCode = String(request.file.meta?.shortCode || '')
    if (!shareId || !shareUk || !shortCode) {
      throw new Error('百度分享缺少下载参数，请重新解析链接后重试')
    }

    if (!(await isLoggedIn('baidu'))) throw new Error('请先登录百度网盘后再预览或下载')
    const context = await downloadContext(request.shareUrl, shareId, shortCode)
    const sekeyCookie = (
      await cloudSession('baidu').cookies.get({ url: 'https://pan.baidu.com/', name: 'BDCLND' })
    )[0]

    const apiUrl = new URL('https://pan.baidu.com/api/sharedownload')
    apiUrl.searchParams.set('sign', context.sign!)
    apiUrl.searchParams.set('timestamp', String(context.timestamp))
    apiUrl.searchParams.set('app_id', '250528')
    apiUrl.searchParams.set('channel', 'chunlei')
    apiUrl.searchParams.set('clienttype', '0')
    apiUrl.searchParams.set('web', '1')
    const response = await cloudSession('baidu').fetch(apiUrl.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'user-agent': USER_AGENT,
        'x-requested-with': 'XMLHttpRequest',
        referer: request.shareUrl
      },
      body: new URLSearchParams({
        encrypt: '0',
        product: 'share',
        uk: shareUk,
        primaryid: shareId,
        fid_list: JSON.stringify([Number(request.file.id)]),
        vip: '0',
        ...(sekeyCookie
          ? { extra: JSON.stringify({ sekey: decodeURIComponent(sekeyCookie.value) }) }
          : {})
      }).toString()
    })
    const payload = (await response.json()) as {
      errno?: number
      errmsg?: string
      error_msg?: string
      list?: Array<{ dlink?: string }> | string
    }
    if (payload.errno === 0 && typeof payload.list === 'string') {
      throw new Error('百度未提供此文件的分享下载直链，请使用网盘在线播放或转存后下载')
    }
    const downloadUrl = Array.isArray(payload.list) ? payload.list[0]?.dlink : undefined
    if (payload.errno !== 0 || !downloadUrl) {
      if (payload.errno === -6 || payload.errno === 112) {
        throw new Error('百度登录状态已失效，请重新登录后再下载')
      }
      throw new Error(
        payload.errmsg ||
          payload.error_msg ||
          `百度未返回下载地址（错误码 ${payload.errno ?? '未知'}）`
      )
    }
    return downloadUrl
  }
}

export function baiduPreviewPageUrl(request: DownloadRequest): string {
  const normalized = normalizeShareInput({ url: request.shareUrl, passcode: request.passcode })
  const shortCode = String(request.file.meta?.shortCode || '')
  if (shortCode && !/^[a-zA-Z0-9_-]+$/.test(shortCode))
    throw new Error('百度分享参数无效，请重新解析')
  // File metadata belongs to the parsed share; the editable input must not change its identity.
  const url = new URL(shortCode ? `https://pan.baidu.com/s/1${shortCode}` : normalized.url)
  if (url.protocol !== 'https:' || !['pan.baidu.com', 'yun.baidu.com'].includes(url.hostname))
    throw new Error('百度预览链接无效')
  url.searchParams.set('fid', request.file.id)
  if (request.file.meta?.serverPath)
    url.searchParams.set('fpath', String(request.file.meta.serverPath))
  if (normalized.passcode) url.searchParams.set('pwd', normalized.passcode)
  return url.toString()
}

// Share video playback uses a different signature and entitlement flow from downloads.
// Let the official page complete that flow, then use its authorized streaming URL.
export async function baiduVideoPreviewUrl(
  request: DownloadRequest,
  signal: AbortSignal
): Promise<string> {
  if (!(await isLoggedIn('baidu'))) throw new Error('请先登录百度网盘后再预览')
  const url = baiduPreviewPageUrl(request)
  const page = new BrowserWindow({
    show: false,
    webPreferences: {
      session: cloudSession('baidu'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  page.webContents.setAudioMuted(true)
  page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const destroy = () => {
    if (!page.isDestroyed()) page.destroy()
  }
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(60000)])
  timeout.addEventListener('abort', destroy, { once: true })
  try {
    timeout.throwIfAborted()
    await page.loadURL(url)
    while (!timeout.aborted) {
      const value = await page.webContents.executeJavaScript(`(() => {
        const resource = performance.getEntriesByType('resource').find(entry => {
          const url = new URL(entry.name)
          return url.origin === 'https://pan.baidu.com' && url.pathname === '/share/streaming' && url.searchParams.has('isplayer')
        })
        return resource ? resource.name : ''
      })()`)
      if (value) {
        const stream = new URL(value)
        // Request the standard MPEG-TS rendition understood by the HLS player.
        stream.searchParams.set('type', 'M3U8_AUTO_480')
        return stream.toString()
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('百度视频初始化超时，请在百度网盘确认该文件可以在线播放')
  } catch (error) {
    if (timeout.aborted)
      throw new Error(signal.aborted ? '预览已关闭' : '百度视频初始化超时，请重新加载')
    throw error
  } finally {
    timeout.removeEventListener('abort', destroy)
    destroy()
  }
}
