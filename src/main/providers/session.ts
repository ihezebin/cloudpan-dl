import { session } from 'electron'
import type { Provider } from '../../shared/types'
import { providerConfig } from './config'

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'

export function cloudSession(provider: Provider) {
  return session.fromPartition(`persist:cloudpan-${provider}`)
}

export async function quarkDownloadToken(): Promise<{ token: string; code?: number }> {
  const seconds = Math.floor(Date.now() / 1000)
  const response = await cloudSession('quark').fetch(
    'https://drive-social-api.quark.cn/1/clouddrive/chat/conv/file/acquire_dl_token?pr=ucpro&fr=pc&sys=win32&ve=6.9.7.761&la=zh-CN&ch=pckk%40product_guanwan',
    {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
      headers: {
        'content-type': 'application/json',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 QuarkPC/6.9.7.761 QuarkCloudDrivePC/6.9.7.761 quark-cloud-drive/2.5.40',
        origin: 'https://pan.quark.cn',
        referer: 'https://pan.quark.cn/'
      },
      body: JSON.stringify({
        conversation_id: `300000${seconds}`,
        conversation_type: 3,
        msg_id: `${seconds}000`
      })
    }
  )
  const payload = (await response.json()) as { code?: number; data?: { token?: string } }
  return { token: payload.data?.token || '', code: payload.code }
}

export async function hasLoginSession(provider: Provider) {
  const cookies = await cloudSession(provider).cookies.get({})
  return providerConfig[provider].cookieNames.some((name) =>
    cookies.some((cookie) => cookie.name === name && Boolean(cookie.value))
  )
}

export async function isLoggedIn(provider: Provider) {
  const hasCookie = await hasLoginSession(provider)
  if (!hasCookie || provider !== 'quark') return hasCookie
  try {
    const response = await cloudSession('quark').fetch(
      'https://pan.quark.cn/account/info?fr=pc&platform=pc',
      { credentials: 'include', signal: AbortSignal.timeout(8000) }
    )
    if (!response.ok) return false
    const payload = (await response.json()) as {
      code?: string
      success?: boolean
      data?: { nickname?: string; mobilekps?: string }
    }
    return Boolean(
      (payload.success || payload.code === 'OK') &&
      (payload.data?.nickname || payload.data?.mobilekps)
    )
  } catch {
    // A temporary account-info failure is not evidence that the local session expired.
    return hasCookie
  }
}

export async function persistLoginCookies(provider: Provider) {
  const providerSession = cloudSession(provider)
  const authCookies = await providerSession.cookies.get({})
  const cookieNames = new Set(providerConfig[provider].cookieNames)
  const persistentUntil = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365

  await Promise.all(
    authCookies
      .filter((cookie) => cookieNames.has(cookie.name) && !cookie.expirationDate)
      .map((cookie) => {
        const domain =
          cookie.domain?.replace(/^\./, '') || new URL(providerConfig[provider].loginUrl).hostname
        const path = cookie.path || '/'
        return providerSession.cookies.set({
          url: `${cookie.secure ? 'https' : 'http'}://${domain}${path}`,
          name: cookie.name,
          value: cookie.value,
          ...(cookie.domain ? { domain: cookie.domain } : {}),
          path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: persistentUntil
        })
      })
  )
  await providerSession.flushStorageData()
}

export async function jsonRequest(provider: Provider, url: string, init?: RequestInit) {
  const response = await cloudSession(provider).fetch(url, {
    ...init,
    // Provider APIs need the partition's login cookies even across origins.
    credentials: 'include',
    headers: {
      'user-agent': USER_AGENT,
      'content-type': 'application/json',
      referer: providerConfig[provider].loginUrl,
      ...(init?.headers || {})
    }
  })
  const text = await response.text()
  let payload: any

  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`平台返回了无法识别的数据（HTTP ${response.status}）`)
  }

  if (!response.ok || (payload?.code && payload.code !== 0)) {
    throw new Error(payload?.message || payload?.msg || `请求失败（HTTP ${response.status}）`)
  }
  return payload
}
