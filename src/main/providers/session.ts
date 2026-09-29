import { session } from 'electron'
import type { Provider } from '../../shared/types'
import { providerConfig } from './config'

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'

export function cloudSession(provider: Provider) {
  return session.fromPartition(`persist:cloudpan-${provider}`)
}

export async function isLoggedIn(provider: Provider) {
  const cookies = await cloudSession(provider).cookies.get({})
  return providerConfig[provider].cookieNames.some((name) =>
    cookies.some((cookie) => cookie.name === name && Boolean(cookie.value))
  )
}

export async function jsonRequest(provider: Provider, url: string, init?: RequestInit) {
  const response = await cloudSession(provider).fetch(url, {
    ...init,
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
