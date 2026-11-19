const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')
function setup() {
  const request = new EventEmitter()
  request.end = () => {}
  request.abort = () => {
    request.aborted = true
    request.emit('close')
  }
  request.followRedirect = () => {
    request.followed = true
  }
  const exports = {}
  runInNewContext(
    ts.transpileModule(readFileSync('src/main/preview-fetch.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      Headers,
      Response,
      ReadableStream,
      Uint8Array,
      require: (name) =>
        name === 'electron'
          ? { net: { request: () => request } }
          : {
              cloudSession: () => ({}),
              assertDownloadUrl: (_provider, url) => {
                if (!url.startsWith('https://cdn.baidupcs.com/')) throw Error('untrusted redirect')
              }
            }
    }
  )
  const controller = new AbortController()
  const promise = exports.fetchPreviewFile(
    'baidu',
    'https://pan.baidu.com/file',
    {},
    controller.signal
  )
  return { request, controller, promise }
}
test('file fetch validates redirects and delivers PDF bytes', async () => {
  const { request, promise } = setup()
  request.emit('redirect', 302, 'GET', 'https://cdn.baidupcs.com/file')
  assert.equal(request.followed, true)
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename=第一章.pdf'
    }
  })
  request.emit('response', response)
  const result = await promise
  response.emit('data', Buffer.from('%PDF-1.7'))
  response.emit('end')
  assert.equal(await result.text(), '%PDF-1.7')
})
test('file fetch refuses untrusted redirects', async () => {
  const { request, promise } = setup()
  request.emit('redirect', 302, 'GET', 'https://untrusted.example/file')
  await assert.rejects(promise, /untrusted/)
  assert.equal(request.aborted, true)
})
test('closing preview aborts an in-progress response body', async () => {
  const { request, controller, promise } = setup()
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} })
  request.emit('response', response)
  const result = await promise
  controller.abort(new Error('closed'))
  await assert.rejects(result.text(), /closed/)
  assert.equal(request.aborted, true)
  response.emit('data', Buffer.from('late bytes'))
})
