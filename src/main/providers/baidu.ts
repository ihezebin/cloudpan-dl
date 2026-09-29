import type { CloudFile, ParseRequest, ParseResult } from '../../shared/types'
import { cloudSession, isLoggedIn, USER_AGENT } from './session'
import type { CloudProviderAdapter } from './types'
import { kindOf } from './utils'

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

export class BaiduProvider implements CloudProviderAdapter {
  readonly provider = 'baidu' as const

  async parse(input: ParseRequest): Promise<ParseResult> {
    const url = new URL(input.url)
    if (input.passcode && !url.searchParams.has('pwd')) url.searchParams.set('pwd', input.passcode)
    let response = await cloudSession('baidu').fetch(url.toString(), {
      headers: { 'user-agent': USER_AGENT, referer: 'https://pan.baidu.com/' }
    })
    let html = await response.text()
    const redirectedUrl = new URL(response.url)
    if (redirectedUrl.pathname === '/share/init') {
      if (!input.passcode) throw new Error('PASSCODE_REQUIRED:该分享需要提取码')
      const code = shareCode(redirectedUrl) || shareCode(url)
      await verifyPasscode(code, input.passcode)
      response = await cloudSession('baidu').fetch(url.toString(), {
        headers: { 'user-agent': USER_AGENT, referer: redirectedUrl.toString() }
      })
      html = await response.text()
    }
    const shareId = shareCode(url)
    const raw =
      balancedArray(html, 'file_list') ||
      balancedArray(html, 'fileList') ||
      balancedArray(html, 'list":') ||
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
        downloadUrl: item.dlink,
        meta: { shareId }
      }
    })
    if (!files.length) throw new Error('百度未返回文件列表。请确认分享有效，或先在官网登录后转存。')
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
      notice: requiresLogin
        ? '下载前请先登录自己的百度网盘账号；平台可能要求先转存到个人网盘。'
        : undefined
    }
  }
}
