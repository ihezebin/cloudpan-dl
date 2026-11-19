const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

test('preview windows isolate requests, reuse files, and release ownership on close', async () => {
  const handlers = {},
    windows = [],
    exports = {}
  class Window extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.webContents = { id: windows.length + 10, setWindowOpenHandler() {} }
      windows.push(this)
    }
    async loadFile(path, options) {
      this.route = options.hash
    }
    isDestroyed() {
      return Boolean(this.closed)
    }
    isMinimized() {
      return true
    }
    restore() {
      this.restored = true
    }
    focus() {
      this.focused = true
    }
    destroy() {
      this.closed = true
      this.emit('closed')
    }
  }
  runInNewContext(
    ts.transpileModule(readFileSync('src/main/preview-window.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      __dirname: '/app/main',
      process: { platform: 'darwin', env: {} },
      require: (name) =>
        name === 'electron'
          ? {
              BrowserWindow: Window,
              nativeTheme: { shouldUseDarkColors: false },
              ipcMain: { handle: (name, fn) => (handlers[name] = fn) }
            }
          : name === './preview-pdf'
            ? { registerPdfPreview() {} }
            : require(name)
    }
  )
  exports.registerPreviewWindows()
  const request = {
    provider: 'baidu',
    shareUrl: 'https://pan.baidu.com/s/test',
    file: { id: '1', name: 'video.mp4' }
  }
  const get = (id) => handlers['preview:window-request']({ sender: { id } })
  const open = (request) => handlers['preview:window-open']({}, request)
  await open(request)
  assert.equal(windows[0].route, 'preview')
  assert.equal(windows[0].options.modal, undefined)
  assert.equal(windows[0].options.parent, undefined)
  assert.equal(get(10), request)
  assert.equal(get(999), null)
  await open(request)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].restored && windows[0].focused, true)
  const other = { ...request, file: { id: '2', name: 'text.txt' } }
  await open(other)
  assert.equal(get(11), other)
  windows[0].destroy()
  assert.equal(get(10), null)
  assert.equal(get(11), other)
  await open(request)
  assert.equal(windows.length, 3)
  await assert.rejects(open({ ...request, file: { isFolder: true } }), /请选择文件/)
})
