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
  const urlText = raw.match(/https?:\/\/[^\s]+/)?.[0] || raw
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
  if (['mp4', 'mkv', 'mov', 'avi', 'flv', 'webm'].includes(ext)) return 'video'
  if (['mp3', 'flac', 'wav', 'aac', 'm4a'].includes(ext)) return 'audio'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return 'image'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'].includes(ext)) return 'document'
  return 'other'
}
