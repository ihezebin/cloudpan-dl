import type { FileKind, ParseRequest, Provider } from '../../shared/types'

export function detectProvider(value: string): Provider {
  let host = ''
  try {
    host = new URL(value).hostname.toLowerCase()
  } catch {
    throw new Error('请输入完整的分享链接')
  }
  if (host === 'pan.quark.cn' || host.endsWith('.quark.cn')) return 'quark'
  if (host === 'pan.baidu.com' || host === 'yun.baidu.com') return 'baidu'
  throw new Error('目前仅支持夸克网盘和百度网盘分享链接')
}

export function normalizeShareInput(input: ParseRequest): ParseRequest {
  const raw = input.url.trim()
  const matches = raw.match(/https?:\/\/[^\s<>"'，。；）)]+/gi) || []
  if (matches.length > 1) throw new Error('请一次只输入一个分享链接')
  let urlText = matches[0] || raw
  // Pasting over a partly selected URL can join an old prefix to a new link.
  // Recover only adjacent share URLs from the same host; do not select arbitrary redirects.
  const pieces = urlText.split(/(?=https?:\/\/)/i)
  if (pieces.length > 1) {
    const urls = pieces.map((value) => new URL(value))
    if (
      !urls.every(
        (value) =>
          value.hostname === urls[0].hostname && /^\/s\/[a-zA-Z0-9_-]+$/.test(value.pathname)
      )
    ) {
      throw new Error('分享链接包含重复或拼接的地址，请清空输入框后重新粘贴')
    }
    urlText = pieces[pieces.length - 1]
  }
  const url = new URL(urlText)
  const embedded =
    url.searchParams.get('pwd') ||
    url.searchParams.get('passcode') ||
    url.searchParams.get('code') ||
    raw.match(/[?&#](?:pwd|passcode|code)=([a-zA-Z0-9]{4,12})/i)?.[1] ||
    raw.match(/(?:提取码|访问码|密码)\s*[:：]?\s*([a-zA-Z0-9]{4,12})/i)?.[1]
  return { url: url.toString(), passcode: input.passcode || embedded || undefined }
}

export function kindOf(name: string, folder: boolean): FileKind {
  if (folder) return 'folder'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['mp4', 'mkv', 'mov', 'avi', 'flv', 'webm', 'wmv', 'm4v', 'ts', 'mpeg', 'mpg'].includes(ext))
    return 'video'
  if (['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'wma', 'ape', 'opus'].includes(ext))
    return 'audio'
  if (
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg', 'tif', 'tiff', 'avif'].includes(ext)
  )
    return 'image'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg'].includes(ext)) return 'archive'
  if (
    [
      'pdf',
      'doc',
      'docx',
      'odt',
      'rtf',
      'xls',
      'xlsx',
      'ods',
      'csv',
      'ppt',
      'pptx',
      'odp',
      'txt',
      'md',
      'json',
      'xml',
      'yaml',
      'yml'
    ].includes(ext)
  )
    return 'document'
  return 'other'
}
