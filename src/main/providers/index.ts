import type { CloudFile, DownloadRequest, ParseRequest, Provider } from '../../shared/types'
import { BaiduProvider, clearBaiduDownloadContext } from './baidu'
import { providerConfig } from './config'
import { QuarkProvider } from './quark'
import { cloudSession, hasLoginSession, isLoggedIn, persistLoginCookies } from './session'
import type { CloudProviderAdapter } from './types'
import { detectProvider, normalizeShareInput } from './utils'

const adapters: Record<Provider, CloudProviderAdapter> = {
  quark: new QuarkProvider(),
  baidu: new BaiduProvider()
}

export async function parseShare(input: ParseRequest) {
  const normalized = normalizeShareInput(input)
  return adapters[detectProvider(normalized.url)].parse(normalized)
}

export async function resolveDownloadUrl(request: DownloadRequest) {
  const resolver = adapters[request.provider].resolveDownloadUrl
  if (resolver) return resolver.call(adapters[request.provider], request)
  if (request.file.downloadUrl) return request.file.downloadUrl
  throw new Error('平台未提供分享文件下载地址')
}

export function downloadHeaders(request: DownloadRequest) {
  return adapters[request.provider].downloadHeaders?.(request) || {}
}

export async function listFolder(provider: Provider, folder: CloudFile) {
  const loader = adapters[provider].listFolder
  if (!loader) throw new Error('该平台暂不支持浏览分享文件夹')
  return loader.call(adapters[provider], folder)
}

export function assertDownloadUrl(provider: Provider, value: string) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') throw new Error('拒绝非 HTTPS 下载地址')
  const allowed = providerConfig[provider].hosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  )
  if (!allowed) throw new Error('下载地址不属于所选网盘平台')
}

export {
  clearBaiduDownloadContext,
  cloudSession,
  hasLoginSession,
  isLoggedIn,
  persistLoginCookies,
  providerConfig
}
