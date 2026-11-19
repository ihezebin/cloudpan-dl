import { protocol, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DownloadRequest } from '../shared/types'
import { previewKind, TEXT_PREVIEW_LIMIT, DOCUMENT_PREVIEW_LIMIT } from '../shared/preview'
import { assertDownloadUrl, cloudSession, downloadHeaders, resolveDownloadUrl } from './providers'
import { baiduVideoPreviewUrl } from './providers/baidu'
import { USER_AGENT } from './providers/session'
import { recordPreviewFailure } from './preview-diagnostics'
import { rewritePlaylist } from './preview-hls'
import { fetchPreviewFile } from './preview-fetch'
import { normalizeShareInput } from './providers/utils'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cloud-preview',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

export function registerPreview() {
  const entries = new Map<
    string,
    {
      request: DownloadRequest
      owner: number
      controller: AbortController
      hls: boolean
      resources: Map<string, string>
      error?: string
      url?: Promise<string>
    }
  >()
  const owners = new Set<number>()
  const close = (id: string) => {
    entries.get(id)?.controller.abort()
    entries.delete(id)
  }
  ipcMain.handle('preview:open', (event, input: DownloadRequest) => {
    const kind = previewKind(input.file.name)
    if (input.file.isFolder || kind === 'unsupported')
      throw new Error('此格式暂不支持内置预览，请下载后打开')
    const normalized = normalizeShareInput({ url: input.shareUrl, passcode: input.passcode })
    for (const [id, entry] of entries) if (entry.owner === event.sender.id) close(id)
    const id = randomUUID()
    entries.set(id, {
      request: {
        ...input,
        shareUrl: normalized.url,
        passcode: normalized.passcode,
        purpose: 'preview'
      },
      hls: input.provider === 'baidu' && kind === 'video',
      resources: new Map(),
      owner: event.sender.id,
      controller: new AbortController()
    })
    if (!owners.has(event.sender.id)) {
      owners.add(event.sender.id)
      event.sender.once('destroyed', () => {
        for (const [key, entry] of entries) if (entry.owner === event.sender.id) close(key)
        owners.delete(event.sender.id)
      })
    }
    return {
      id,
      kind,
      hls: input.provider === 'baidu' && kind === 'video',
      url: `cloud-preview://file/${id}`
    }
  })
  ipcMain.handle('preview:close', (event, id: string) => {
    if (entries.get(id)?.owner === event.sender.id) close(id)
  })
  ipcMain.handle('preview:error', (event, id: string) =>
    entries.get(id)?.owner === event.sender.id ? entries.get(id)?.error : undefined
  )
  protocol.handle('cloud-preview', async (request) => {
    const [id, resourceId] = new URL(request.url).pathname.slice(1).split('/')
    const entry = entries.get(id)
    if (!entry) return new Response('预览已关闭', { status: 410 })
    const kind = previewKind(entry.request.file.name)
    const media = kind === 'video' || kind === 'audio'
    const signal = AbortSignal.any([
      entry.controller.signal,
      request.signal,
      ...(!media ? [AbortSignal.timeout(120000)] : [])
    ])
    let stage = '获取播放地址'
    try {
      entry.url ??= (
        entry.hls
          ? baiduVideoPreviewUrl(entry.request, entry.controller.signal)
          : resolveDownloadUrl(entry.request)
      ).catch((error) => {
        entry.url = undefined
        throw error
      })
      let url = resourceId ? entry.resources.get(resourceId) : await entry.url
      if (!url) return new Response('预览资源不存在', { status: 404 })
      signal.throwIfAborted()
      const headers: Record<string, string> = entry.hls
        ? { 'user-agent': USER_AGENT, referer: 'https://pan.baidu.com/' }
        : { ...downloadHeaders(entry.request) }
      if (media && request.headers.has('range')) headers.Range = request.headers.get('range')!
      if (kind === 'text') headers.Range = `bytes=0-${TEXT_PREVIEW_LIMIT - 1}`
      stage = entry.hls ? (resourceId ? '读取视频分片' : '读取播放清单') : '读取文件内容'
      let upstream: Response | undefined
      for (let hop = 0; hop < 6; hop++) {
        assertDownloadUrl(entry.request.provider, url)
        upstream = !entry.hls
          ? await fetchPreviewFile(entry.request.provider, url, headers, signal)
          : await cloudSession(entry.request.provider).fetch(url, {
              headers,
              signal,
              credentials: 'include',
              redirect: 'manual'
            })
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break
        const location = upstream.headers.get('location')
        await upstream.body?.cancel()
        if (!location) throw new Error('文件地址跳转无效')
        url = new URL(location, url).toString()
      }
      if (!upstream || !upstream.ok) {
        if (upstream?.status === 401 || upstream?.status === 403) entry.url = undefined
        if (upstream?.status === 416)
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range':
                upstream.headers.get('content-range') || `bytes */${entry.request.file.size}`
            }
          })
        throw new Error(`文件读取失败（HTTP ${upstream?.status || '未知'}），请重试或重新登录`)
      }
      const outputHeaders = new Headers({
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      })
      if (
        entry.hls &&
        (!resourceId || /mpegurl/i.test(upstream.headers.get('content-type') || ''))
      ) {
        const playlist = await upstream.text()
        if (!playlist.trimStart().startsWith('#EXTM3U')) {
          let code: number | undefined
          try {
            code = JSON.parse(playlist).errno
          } catch {}
          throw new Error(
            `百度未返回可播放的视频流（错误码 ${code ?? '未知'}），请确认该视频支持在线播放`
          )
        }
        const resourceKeys = new Map([...entry.resources].map(([key, value]) => [value, key]))
        const rewritten = rewritePlaylist(playlist, url, (remote) => {
          assertDownloadUrl(entry.request.provider, remote)
          let key = resourceKeys.get(remote)
          if (!key) {
            key = String(entry.resources.size + 1)
            entry.resources.set(key, remote)
            resourceKeys.set(remote, key)
          }
          return `cloud-preview://file/${id}/${key}`
        })
        outputHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
        return new Response(rewritten, { headers: outputHeaders })
      }
      if (media) {
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const value = upstream.headers.get(name)
          if (value) outputHeaders.set(name, value)
        }
        return new Response(upstream.body, { status: upstream.status, headers: outputHeaders })
      }
      const limit = kind === 'text' ? TEXT_PREVIEW_LIMIT : DOCUMENT_PREVIEW_LIMIT
      const reader = upstream.body?.getReader()
      if (!reader) throw new Error('文件内容为空')
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const remaining = limit - length
          if (value.length > remaining && kind !== 'text')
            throw new Error('此文件超过 30 MB 预览上限，请下载后打开')
          const part = value.subarray(0, remaining)
          chunks.push(part)
          length += part.length
          if (length >= limit && kind === 'text') break
        }
      } finally {
        await reader.cancel()
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      outputHeaders.set('Content-Type', 'application/octet-stream')
      return new Response(bytes, { headers: outputHeaders })
    } catch (error) {
      if (request.signal.aborted || entry.controller.signal.aborted)
        return new Response(null, { status: 499 })
      const detail = error instanceof Error ? error.message : String(error)
      entry.error = `${stage}失败：${detail}`
      recordPreviewFailure(entry.request.provider, entry.request.file.name, stage, detail)
      return new Response(entry.error, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }
  })
}
