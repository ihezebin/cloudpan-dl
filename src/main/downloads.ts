import { BrowserWindow, shell } from 'electron'
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { AppSettings, DownloadRequest, DownloadTask } from '../shared/types'
import { assertDownloadUrl, cloudSession, resolveDownloadUrl } from './providers'

type InternalTask = DownloadTask & {
  request: DownloadRequest
  controller?: AbortController
  previousAt?: number
  previousBytes?: number
  abortIntent?: 'paused' | 'cancelled'
}

type StoredTask = DownloadTask & { request: DownloadRequest }

export class DownloadManager {
  private tasks = new Map<string, InternalTask>()
  private historyStore = new Store<{ tasks: StoredTask[] }>({
    name: 'download-history',
    defaults: { tasks: [] }
  })

  constructor(
    private window: () => BrowserWindow | null,
    private settings: () => AppSettings
  ) {
    for (const saved of this.historyStore.get('tasks')) {
      this.tasks.set(saved.id, {
        ...saved,
        speed: 0,
        status: ['queued', 'preparing', 'downloading'].includes(saved.status)
          ? 'paused'
          : saved.status
      })
    }
  }

  list() {
    return [...this.tasks.values()].map(
      ({ request: _r, controller: _c, previousAt: _a, previousBytes: _b, ...task }) => task
    )
  }
  private persist() {
    const tasks = [...this.tasks.values()].map(
      ({
        controller: _controller,
        previousAt: _at,
        previousBytes: _bytes,
        abortIntent: _intent,
        ...task
      }) => task
    )
    this.historyStore.set('tasks', tasks)
  }

  private emit(save = true) {
    if (save) this.persist()
    this.window()?.webContents.send('downloads:changed', this.list())
  }

  add(items: DownloadRequest[]) {
    const created = items
      .filter((item) => !item.file.isFolder)
      .map((item) => {
        const safeName =
          basename(item.file.name).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'download'
        // The renderer cannot choose an arbitrary filesystem destination. Only the
        // directory selected through the trusted settings dialog is used here.
        const savePath = join(this.settings().defaultDownloadPath, safeName)
        const task: InternalTask = {
          id: randomUUID(),
          provider: item.provider,
          fileName: safeName,
          savePath,
          size: item.file.size,
          received: 0,
          speed: 0,
          status: 'queued',
          createdAt: Date.now(),
          request: item
        }
        this.tasks.set(task.id, task)
        return task
      })
    this.emit()
    void this.pump()
    return created.map((task) => this.list().find((item) => item.id === task.id)!)
  }

  private async pump() {
    const active = [...this.tasks.values()].filter((t) =>
      ['preparing', 'downloading'].includes(t.status)
    ).length
    const slots = Math.max(0, this.settings().concurrency - active)
    const queued = [...this.tasks.values()].filter((t) => t.status === 'queued').slice(0, slots)
    await Promise.allSettled(queued.map((task) => this.run(task)))
    if ([...this.tasks.values()].some((t) => t.status === 'queued')) void this.pump()
  }

  private async run(task: InternalTask) {
    task.status = 'preparing'
    task.error = undefined
    task.abortIntent = undefined
    this.emit()
    try {
      const url = await resolveDownloadUrl(task.request)
      assertDownloadUrl(task.provider, url)
      mkdirSync(dirname(task.savePath), { recursive: true })
      const partPath = `${task.savePath}.part`
      const offset = existsSync(partPath) ? statSync(partPath).size : 0
      task.received = offset
      task.controller = new AbortController()
      const response = await cloudSession(task.provider).fetch(url, {
        signal: task.controller.signal,
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined
      })
      if (!response.ok && response.status !== 206)
        throw new Error(`下载服务器返回 HTTP ${response.status}`)
      const append = offset > 0 && response.status === 206
      if (!append) task.received = 0
      task.status = 'downloading'
      task.previousAt = Date.now()
      task.previousBytes = task.received
      this.emit()
      if (!response.body) throw new Error('下载响应没有数据')
      const source = Readable.fromWeb(response.body as any)
      source.on('data', (chunk: Buffer) => {
        task.received += chunk.length
        const now = Date.now()
        if (now - (task.previousAt || now) >= 500) {
          task.speed = Math.round(
            ((task.received - (task.previousBytes || 0)) * 1000) / (now - (task.previousAt || now))
          )
          task.previousAt = now
          task.previousBytes = task.received
          this.emit(false)
        }
      })
      await pipeline(source, createWriteStream(partPath, { flags: append ? 'a' : 'w' }))
      if (existsSync(task.savePath)) unlinkSync(task.savePath)
      const { renameSync } = await import('node:fs')
      renameSync(partPath, task.savePath)
      task.status = 'completed'
      task.speed = 0
      task.received = statSync(task.savePath).size
    } catch (error) {
      if (task.abortIntent) task.status = task.abortIntent
      else {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      task.controller = undefined
      this.emit()
      void this.pump()
    }
  }

  async action(id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'delete') {
    const task = this.tasks.get(id)
    if (!task) return
    if (action === 'pause' && ['preparing', 'downloading'].includes(task.status)) {
      task.abortIntent = 'paused'
      task.status = 'paused'
      task.controller?.abort()
    }
    if (action === 'resume' && ['paused', 'failed'].includes(task.status)) {
      task.status = 'queued'
      task.error = undefined
      void this.pump()
    }
    if (action === 'cancel') {
      task.abortIntent = 'cancelled'
      task.status = 'cancelled'
      task.controller?.abort()
    }
    if (action === 'open') await shell.showItemInFolder(task.savePath)
    if (action === 'delete') {
      task.abortIntent = 'cancelled'
      task.controller?.abort()
      this.tasks.delete(id)
    }
    this.emit()
  }
}
