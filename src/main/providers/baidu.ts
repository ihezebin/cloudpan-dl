import { BrowserWindow } from 'electron'
import type { CloudFile, DownloadRequest, ParseRequest, ParseResult } from '../../shared/types'
import { cloudSession, isLoggedIn, USER_AGENT } from './session'
import type { CloudProviderAdapter } from './types'
import { kindOf } from './utils'

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

interface DownloadContext {
  sign: string
  timestamp: number | string
}

const contextCache = new Map<string, { value: DownloadContext; expiresAt: number }>()

export function clearBaiduDownloadContext() {
  contextCache.clear()
}

async function downloadContext(shareUrl: string): Promise<DownloadContext> {
  const cached = contextCache.get(shareUrl)
  if (cached && cached.expiresAt > Date.now()) return cached.value

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

  downloadHeaders(request: DownloadRequest) {
    return {
      'user-agent': BAIDU_DOWNLOAD_USER_AGENT,
      referer: request.shareUrl
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
    const shareData = balancedObject(html, 'locals.mset(')
    const numericShareId = String(shareData?.shareid || '')
    const shareUk = String(shareData?.share_uk || '')
    const raw =
      balancedArray(html, '"file_list":') ||
      balancedArray(html, '"fileList":') ||
      balancedArray(html, '"list":') ||
      []
    const files: CloudFile[] = (raw as any[]).map((item) => {
      const folder = item.isdir === 1 || item.isdir === true
      const name = item.server_filename || item.filename || item.name || '未命名'
      return {
        id: String(item.fs_id || item.id),
        name,
        size: Number(item.size || 0),
        isFolder: folder,
        kind: kindOf(name, folder),
        meta: { shareId: numericShareId, shareUk, shortCode: shareId }
      }
    })
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

  async resolveDownloadUrl(request: DownloadRequest): Promise<string> {
    const shareId = String(request.file.meta?.shareId || '')
    const shareUk = String(request.file.meta?.shareUk || '')
    const shortCode = String(request.file.meta?.shortCode || '')
    if (!shareId || !shareUk || !shortCode) {
      throw new Error('百度分享缺少下载参数，请重新解析链接后重试')
    }

    const context = await downloadContext(request.shareUrl)
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
      list?: Array<{ dlink?: string }>
    }
    const downloadUrl = payload.list?.[0]?.dlink
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
