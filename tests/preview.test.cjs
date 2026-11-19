const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
function setup(fetch, resolveVideo) {
  const handlers = {}
  let serve
  let resolvedRequest
  const sender = Object.assign(new EventEmitter(), { id: 1 })
  function load(filename) {
    const exports = {}
    runInNewContext(
      ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      {
        exports,
        URL,
        URLSearchParams,
        AbortSignal,
        AbortController,
        Response,
        Headers,
        Uint8Array,
        require(name) {
          if (name === './preview-fetch')
            return {
              fetchPreviewFile: (_provider, url, headers, signal) =>
                fetch(url, { headers, signal, credentials: 'include', redirect: 'manual' })
            }
          if (name === 'electron')
            return {
              protocol: {
                registerSchemesAsPrivileged() {},
                handle(scheme, fn) {
                  serve = fn
                }
              },
              ipcMain: {
                handle(name, fn) {
                  handlers[name] = fn
                }
              }
            }
          if (name === './providers/baidu')
            return {
              baiduVideoPreviewUrl:
                resolveVideo || (async () => 'https://pan.baidu.com/playlist.m3u8')
            }
          if (name === './providers/session') return { USER_AGENT: 'test' }
          if (name === './providers')
            return {
              cloudSession: () => ({ fetch }),
              downloadHeaders: () => ({ Referer: 'https://pan.baidu.com/' }),
              resolveDownloadUrl: async (request) => {
                resolvedRequest = request
                return 'https://pan.baidu.com/file'
              },
              assertDownloadUrl: (_provider, url) => {
                if (new URL(url).hostname !== 'pan.baidu.com') throw new Error('非法域名')
              }
            }
          if (name.startsWith('node:')) return require(name)
          return load(resolve(dirname(filename), `${name}.ts`))
        }
      }
    )
    return exports
  }
  load(resolve(__dirname, '../src/main/preview.ts')).registerPreview()
  return {
    open: (name, provider = 'quark') =>
      handlers['preview:open'](
        { sender },
        {
          provider,
          shareUrl: '链接: https://pan.baidu.com/s/1abc 提取码: 7xrg',
          file: { name, size: 12 }
        }
      ),
    close: (id) => handlers['preview:close']({ sender }, id),
    error: (id) => handlers['preview:error']({ sender }, id),
    serve: (url, headers, signal) => serve(new Request(url, { headers, signal })),
    request: () => resolvedRequest,
    sender
  }
}
test('media forwards Range and preserves partial content without exposing upstream URL', async () => {
  const app = setup(async (url, options) => {
    assert.equal(options.headers.Range, 'bytes=4-7')
    assert.equal(options.credentials, 'include')
    return new Response('data', {
      status: 206,
      headers: {
        'Content-Range': 'bytes 4-7/12',
        'Content-Length': '4',
        'Content-Type': 'video/mp4'
      }
    })
  })
  const source = app.open('movie.mp4')
  const response = await app.serve(source.url, { Range: 'bytes=4-7' })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 4-7/12')
  assert.equal(await response.text(), 'data')
  assert.equal(app.request().purpose, 'preview')
  assert.equal(app.request().passcode, '7xrg')
  assert.equal(app.request().shareUrl, 'https://pan.baidu.com/s/1abc')
})
test('text truncates even when upstream ignores Range', async () => {
  const app = setup(async () => new Response('x'.repeat(3 * 1024 * 1024)))
  const response = await app.serve(app.open('notes.txt').url)
  assert.equal((await response.arrayBuffer()).byteLength, 2 * 1024 * 1024)
})
test('oversized documents fail without displaying partial corrupt data', async () => {
  const app = setup(async () => new Response(new Uint8Array(31 * 1024 * 1024)))
  const response = await app.serve(app.open('book.pdf').url)
  assert.equal(response.status, 502)
  assert.match(await response.text(), /30 MB/)
})
test('closing or replacing preview cancels streams and revokes URL', async () => {
  let signal
  const app = setup(async (_url, options) => {
    signal = options.signal
    return new Response('data')
  })
  const first = app.open('movie.mp4')
  await app.serve(first.url)
  app.close(first.id)
  assert.equal(signal.aborted, true)
  assert.equal((await app.serve(first.url)).status, 410)
  const second = app.open('notes.txt')
  app.open('other.txt')
  assert.equal((await app.serve(second.url)).status, 410)
  assert.equal(app.sender.listenerCount('destroyed'), 1)
})
test('redirect destinations are validated and unsupported types never fetch', async () => {
  let calls = 0
  const app = setup(async () => {
    calls++
    return new Response(null, { status: 302, headers: { location: 'https://example.com/private' } })
  })
  const response = await app.serve(app.open('notes.txt').url)
  assert.equal(response.status, 502)
  assert.equal(calls, 1)
  assert.throws(() => app.open('program.exe'), /暂不支持/)
})

test('player can retrieve the actual upstream failure message', async () => {
  const app = setup(async () => new Response('Forbidden', { status: 403 }))
  const source = app.open('movie.mp4')
  const result = await app.serve(source.url)
  assert.equal(result.status, 502)
  assert.match(app.error(source.id), /HTTP 403/)
  app.close(source.id)
  assert.equal(app.error(source.id), undefined)
})

test('Baidu HLS rewrites playlist segments and keys to revocable opaque URLs', async () => {
  const app = setup(async (url, options) => {
    assert.equal(options.headers.referer, 'https://pan.baidu.com/')
    if (url.endsWith('playlist.m3u8'))
      return new Response(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\nsegment.ts?secret=value\n#EXT-X-ENDLIST'
      )
    return new Response(url.endsWith('key.bin') ? 'key' : 'segment')
  })
  const source = app.open('movie.mp4', 'baidu')
  assert.equal(source.hls, true)
  const playlist = await (await app.serve(source.url)).text()
  assert.ok(!playlist.includes('secret=value'))
  assert.ok(!playlist.includes('https://pan.baidu.com'))
  const key = playlist.match(/URI="([^"]+)"/)[1]
  const segment = playlist.split('\n').find((line) => line.startsWith('cloud-preview:'))
  assert.equal(await (await app.serve(key)).text(), 'key')
  assert.equal(await (await app.serve(segment)).text(), 'segment')
  app.close(source.id)
  assert.equal((await app.serve(segment)).status, 410)
})

test('Baidu streaming errors are exposed as notifications rather than fed into the decoder', async () => {
  const app = setup(
    async () => new Response('{"errno":71}', { headers: { 'Content-Type': 'application/json' } })
  )
  const source = app.open('movie.mp4', 'baidu')
  assert.equal((await app.serve(source.url)).status, 502)
  assert.match(app.error(source.id), /错误码 71/)
})

test('a timed-out manifest request does not cancel shared video initialization', async () => {
  let finish, sourceSignal
  const source = new Promise((resolve) => {
    finish = resolve
  })
  const app = setup(
    async () => new Response('#EXTM3U\n#EXT-X-ENDLIST'),
    (_request, signal) => {
      sourceSignal = signal
      return source
    }
  )
  const opened = app.open('movie.mp4', 'baidu')
  const controller = new AbortController()
  const first = app.serve(opened.url, undefined, controller.signal)
  controller.abort()
  assert.equal(sourceSignal.aborted, false)
  finish('https://pan.baidu.com/playlist.m3u8')
  assert.equal((await first).status, 499)
  assert.equal(app.error(opened.id), undefined)
  assert.equal((await app.serve(opened.url)).status, 200)
  app.close(opened.id)
  assert.equal(sourceSignal.aborted, true)
})
