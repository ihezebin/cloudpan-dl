import { useEffect, useState, useRef } from 'react'
import { App, Button, Select, Space } from 'antd'
import { DownloadOutlined, ReloadOutlined, FileOutlined } from '@ant-design/icons'
import { formatBytes } from '../utils/format'
import type { DownloadRequest } from '../../../shared/types'
import { previewKind, TEXT_PREVIEW_LIMIT } from '../../../shared/preview'
import Hls from 'hls.js'
import PreviewWorker from './preview.worker?worker'

interface Page {
  title: string
  text: string
  rows?: Array<{ number: string; cells: string[] }>
}
const mime: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon'
}
function xml(value: string) {
  const doc = new DOMParser().parseFromString(value, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('文档内容无法解析')
  return doc
}
const nodes = (element: Document | Element, name: string) =>
  Array.from(element.getElementsByTagNameNS('*', name))
function officePages(files: Record<string, string>, kind: string): Page[] {
  if (kind === 'docx')
    return [
      {
        title: '正文',
        text: nodes(xml(files['word/document.xml'] || ''), 'p')
          .map((p) =>
            nodes(p, 't')
              .map((t) => t.textContent)
              .join('')
          )
          .join('\n')
      }
    ]
  if (kind === 'slides')
    return Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+.xml$/.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name, i) => ({
        title: `幻灯片 ${i + 1}`,
        text: nodes(xml(files[name]), 'p')
          .map((p) =>
            nodes(p, 't')
              .map((t) => t.textContent)
              .join('')
          )
          .join('\n')
      }))
  const strings = files['xl/sharedStrings.xml']
    ? nodes(xml(files['xl/sharedStrings.xml']), 'si').map((s) =>
        nodes(s, 't')
          .map((t) => t.textContent)
          .join('')
      )
    : []
  const workbook = xml(files['xl/workbook.xml'] || '')
  const relations = nodes(xml(files['xl/_rels/workbook.xml.rels'] || ''), 'Relationship')
  return nodes(workbook, 'sheet').map((sheet) => {
    const relation = relations.find((r) => r.getAttribute('Id') === sheet.getAttribute('r:id'))
    const target = relation?.getAttribute('Target') || ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const content = files[path]
    if (!content) return { title: sheet.getAttribute('name') || '工作表', text: '此工作表无法预览' }
    const rows = nodes(xml(content), 'row')
    const tableRows = rows.slice(0, 1000).map((row, index) => {
      const cells: string[] = []
      for (const cell of nodes(row, 'c')) {
        const letters = cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0] || 'A'
        let col = 0
        for (const c of letters) col = col * 26 + c.charCodeAt(0) - 64
        if (col > 100) continue
        const value = nodes(cell, 'v')[0]?.textContent || ''
        cells[col - 1] =
          cell.getAttribute('t') === 's'
            ? strings[Number(value)] || ''
            : cell.getAttribute('t') === 'inlineStr'
              ? nodes(cell, 't')
                  .map((t) => t.textContent)
                  .join('')
              : value
      }
      return {
        number: row.getAttribute('r') || String(index + 1),
        cells: Array.from({ length: cells.length }, (_, i) => cells[i] || '')
      }
    })
    return {
      title: sheet.getAttribute('name') || '工作表',
      rows: tableRows,
      text: tableRows.map((row) => row.cells.join('\t')).join('\n')
    }
  })
}

function columnName(index: number): string {
  return index < 26
    ? String.fromCharCode(65 + index)
    : columnName(Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26))
}

export function PreviewContent({ request }: { request: DownloadRequest }) {
  const { notification } = App.useApp()
  const sourceId = useRef('')
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const pdfHost = useRef<HTMLDivElement>(null)
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer>()
  const [hls, setHls] = useState(false)
  const playbackEpoch = useRef(0)
  const failureTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function mediaReady() {
    playbackEpoch.current += 1
    if (failureTimer.current) clearTimeout(failureTimer.current)
    failureTimer.current = null
    setLoading(false)
    setError('')
    notification.destroy('file-preview-error')
  }
  async function mediaFailed(fallback: string, stillActive: () => boolean = () => true) {
    const id = sourceId.current
    const epoch = playbackEpoch.current
    if (!id || !stillActive()) return
    const detail = await window.cloudPan.previewError(id).catch(() => undefined)
    if (sourceId.current !== id || epoch !== playbackEpoch.current || !stillActive()) return
    if (failureTimer.current) clearTimeout(failureTimer.current)
    failureTimer.current = setTimeout(() => {
      if (sourceId.current !== id || epoch !== playbackEpoch.current || !stillActive()) return
      setLoading(false)
      setError(detail || fallback)
    }, 1500)
  }
  const kind = previewKind(request.file.name)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (error)
      notification.error({
        key: 'file-preview-error',
        title: '文件预览失败',
        description: error,
        placement: 'topRight',
        duration: 8
      })
  }, [error, notification])
  const [url, setUrl] = useState('')
  const [bytes, setBytes] = useState<ArrayBuffer>()
  const [encoding, setEncoding] = useState('utf-8')
  const [pages, setPages] = useState<Page[]>([])
  const [page, setPage] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [downloaded, setDownloaded] = useState(false)
  useEffect(() => {
    let id = '',
      blob = '',
      disposed = false
    let worker: Worker | undefined
    const controller = new AbortController()
    setLoading(true)
    setError('')
    notification.destroy('file-preview-error')
    playbackEpoch.current += 1
    setUrl('')
    setHls(false)
    setPages([])
    setPage(0)
    setBytes(undefined)
    setPdfBytes(undefined)
    async function load() {
      if (kind === 'unsupported')
        throw new Error('此格式暂不支持内置预览，请下载后使用对应软件打开。')
      const source = await window.cloudPan.openPreview(request)
      id = source.id
      if (disposed) {
        await window.cloudPan.closePreview(id)
        return
      }
      sourceId.current = id
      if (kind === 'video' || kind === 'audio') {
        setHls(Boolean(source.hls))
        setUrl(source.url)
        return
      }
      const response = await fetch(source.url, { signal: controller.signal })
      if (!response.ok) throw new Error(await response.text())
      const content = await response.arrayBuffer()
      if (disposed) return
      if (kind === 'text') {
        setBytes(content)
        try {
          const prefix = new Uint8Array(content, 0, Math.min(2, content.byteLength))
          if (prefix[0] === 255 && prefix[1] === 254) setEncoding('utf-16le')
          else if (prefix[0] === 254 && prefix[1] === 255) setEncoding('utf-16be')
          else {
            new TextDecoder('utf-8', { fatal: true }).decode(content, {
              stream: content.byteLength >= TEXT_PREVIEW_LIMIT
            })
            setEncoding('utf-8')
          }
        } catch {
          setEncoding('gb18030')
        }
      } else if (kind === 'pdf') {
        setPdfBytes(content)
        return
      } else if (kind === 'image') {
        const ext = request.file.name.split('.').pop()?.toLowerCase() || ''
        blob = URL.createObjectURL(
          new Blob([content], { type: mime[ext] || 'application/octet-stream' })
        )
        setUrl(blob)
      } else {
        worker = new PreviewWorker()
        const result = await new Promise<{ names: string[]; files: Record<string, string> }>(
          (resolve, reject) => {
            worker!.onmessage = ({ data }) =>
              data.error ? reject(new Error(data.error)) : resolve(data)
            worker!.onerror = () => reject(new Error('文档解析失败'))
            worker!.postMessage({ bytes: content, kind }, [content])
          }
        )
        if (disposed) return
        const resultPages =
          kind === 'zip'
            ? [{ title: '压缩包目录', text: result.names.join('\n') }]
            : officePages(result.files, kind)
        setPages(
          resultPages.length ? resultPages : [{ title: '内容', text: '没有可预览的文字内容' }]
        )
      }
      setLoading(false)
    }
    void load().catch((reason) => {
      if (!disposed) {
        setError(String(reason.message || reason))
        setLoading(false)
      }
    })
    return () => {
      disposed = true
      if (failureTimer.current) clearTimeout(failureTimer.current)
      playbackEpoch.current += 1
      sourceId.current = ''
      controller.abort()
      worker?.terminate()
      if (blob) URL.revokeObjectURL(blob)
      if (id) void window.cloudPan.closePreview(id)
    }
  }, [request, kind, attempt])
  useEffect(() => {
    const video = videoElement
    if (!hls || !url || !video) return
    if (!Hls.isSupported()) {
      void mediaFailed('当前环境不支持 HLS 视频播放')
      return
    }
    const player = new Hls({
      enableWorker: false,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      // The provider may need up to 60 seconds to initialize its official player.
      manifestLoadPolicy: {
        default: { ...Hls.DefaultConfig.manifestLoadPolicy.default, maxLoadTimeMs: 75000 }
      }
    })
    let active = true
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (active && data.fatal)
        void mediaFailed(`视频流播放失败（${data.details}），请重新加载`, () => active)
    })
    player.loadSource(url)
    player.attachMedia(video)
    return () => {
      active = false
      player.destroy()
    }
  }, [hls, url, videoElement])
  useEffect(() => {
    const host = pdfHost.current
    if (!pdfBytes || !host) return
    let active = true
    const rect = () => {
      const r = host.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const observer = new ResizeObserver(() => window.cloudPan.resizePdfPreview(rect()))
    observer.observe(host)
    void window.cloudPan
      .showPdfPreview(pdfBytes, rect())
      .then(() => {
        if (active) setLoading(false)
      })
      .catch((reason) => {
        if (active) {
          setLoading(false)
          setError(String(reason.message || reason))
        }
      })
    return () => {
      active = false
      observer.disconnect()
      window.cloudPan.closePdfPreview()
    }
  }, [pdfBytes])
  const tableWidth = Math.max(1, ...(pages[page]?.rows || []).map((row) => row.cells.length))
  const text = bytes ? new TextDecoder(encoding).decode(bytes) : pages[page]?.text || ''
  async function download() {
    try {
      await window.cloudPan.addDownloads([request])
      setDownloaded(true)
    } catch (reason) {
      setError(String(reason))
    }
  }
  return (
    <section
      className={`preview-window ${window.cloudPan.platform === 'darwin' ? 'preview-mac' : ''}`}
    >
      <header className="preview-header">
        <div className="preview-file-icon">
          <FileOutlined />
        </div>
        <div className="preview-heading">
          <h1 title={request.file.name}>{request.file.name}</h1>
          <p>
            {request.provider === 'baidu' ? '百度网盘' : '夸克网盘'}
            <span>·</span>
            {formatBytes(request.file.size)}
            <span>·</span>文件预览
          </p>
        </div>
        <div className="preview-header-actions">
          <Button icon={<ReloadOutlined />} onClick={() => setAttempt((a) => a + 1)}>
            重新加载
          </Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            disabled={downloaded}
            onClick={download}
          >
            {downloaded ? '已加入下载' : '下载'}
          </Button>
        </div>
      </header>
      <div
        className={`preview-stage ${kind === 'video' || kind === 'audio' ? 'preview-stage-media' : ''}`}
      >
        {loading && (
          <div className="preview-loading" role="status">
            <div className="preview-loading-card">
              <div className="preview-orbit">
                <FileOutlined />
              </div>
              <h2>{kind === 'video' ? '正在准备视频' : '正在读取文件'}</h2>
              <p>
                {kind === 'video' ? '正在连接网盘，画面就绪后即可播放' : '内容就绪后将在这里显示'}
              </p>
              <div className="preview-loading-track">
                <span />
              </div>
            </div>
          </div>
        )}
        {error && !url && (
          <div className="preview-empty">
            <FileOutlined />
            <h2>暂时无法预览</h2>
            <p>可以重新加载，或下载文件后查看</p>
            <Button onClick={() => setAttempt((a) => a + 1)}>重新加载</Button>
          </div>
        )}
        <div className="preview-content" style={loading ? { visibility: 'hidden' } : undefined}>
          {kind === 'text' && bytes && (
            <Space className="preview-toolbar">
              <Select
                value={encoding}
                onChange={setEncoding}
                options={['utf-8', 'gb18030', 'utf-16le', 'utf-16be', 'big5'].map((value) => ({
                  value,
                  label: value.toUpperCase()
                }))}
              />
              <Button
                onClick={() =>
                  navigator.clipboard
                    .writeText(text)
                    .catch(() => setError('复制失败，请手动选择文本复制'))
                }
              >
                复制内容
              </Button>
              {bytes.byteLength >= TEXT_PREVIEW_LIMIT && <span>仅显示前 2 MB</span>}
            </Space>
          )}
          {['docx', 'sheet', 'slides'].includes(kind) && !loading && !error && (
            <p className="preview-notice">
              内容预览：不还原原始排版；表格显示缓存值（最多 1000 行、100 列），不执行公式。
            </p>
          )}
          {pages.length > 0 && (
            <Select
              className="preview-toolbar"
              value={page}
              onChange={setPage}
              options={pages.map((p, i) => ({ value: i, label: p.title }))}
            />
          )}
          {pages[page]?.rows ? (
            <div className="preview-sheet">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {Array.from({ length: tableWidth }, (_, col) => (
                      <th key={col}>{columnName(col)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pages[page].rows!.map((row, index) => (
                    <tr key={index}>
                      <th>{row.number}</th>
                      {Array.from({ length: tableWidth }, (_, col) => (
                        <td key={col}>{row.cells[col] || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            (bytes || pages.length > 0) && <pre className="preview-text">{text}</pre>
          )}
          {url && kind === 'image' && (
            <img
              className="preview-image"
              src={url}
              alt={request.file.name}
              onError={() => setError('图片无法解码，请下载后打开')}
            />
          )}
          {kind === 'pdf' && <div ref={pdfHost} className="preview-pdf" />}
          {url && (kind === 'video' || kind === 'audio') && (
            <>
              {kind === 'video' ? (
                <video
                  key={url + attempt}
                  className="preview-video"
                  ref={setVideoElement}
                  src={hls ? undefined : url}
                  controls
                  preload="metadata"
                  onLoadStart={() => setLoading(true)}
                  onLoadedData={mediaReady}
                  onCanPlay={mediaReady}
                  onPlaying={mediaReady}
                  onError={() => {
                    void mediaFailed(
                      '视频无法播放，可能是格式不兼容、链接失效或网盘访问受限。可重新加载或下载后打开。'
                    )
                  }}
                />
              ) : (
                <audio
                  key={url + attempt}
                  className="preview-audio"
                  src={url}
                  controls
                  preload="metadata"
                  onLoadStart={() => setLoading(true)}
                  onLoadedData={mediaReady}
                  onCanPlay={mediaReady}
                  onPlaying={mediaReady}
                  onError={() => {
                    void mediaFailed('音频无法播放，请重新加载或下载后打开。')
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
      <footer className="preview-footer">
        <span className={`preview-status ${error ? 'is-error' : ''}`}>
          <i />
          {error ? '加载遇到问题' : loading ? '正在加载' : '预览就绪'}
        </span>
        {(kind === 'video' || kind === 'audio') && (
          <div className="preview-speed">
            <span>播放速度</span>
            <Select
              defaultValue={1}
              options={[0.5, 1, 1.25, 1.5, 2].map((value) => ({ value, label: `${value}×` }))}
              onChange={(value) => {
                const media = document.querySelector<HTMLMediaElement>(
                  '.preview-video, .preview-audio'
                )
                if (media) media.playbackRate = value
              }}
            />
          </div>
        )}
        <span className="preview-footer-hint">
          {kind === 'video'
            ? '支持倍速播放与全屏'
            : kind === 'pdf'
              ? '浏览器 PDF 阅读器 · 关闭后清理临时文件'
              : '仅预览，不会自动保存文件'}
        </span>
      </footer>
    </section>
  )
}
