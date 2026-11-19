const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')
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
      require(name) {
        if (name === 'electron' || name === './session') return {}
        return load(resolve(dirname(filename), name + '.ts'))
      }
    }
  )
  return exports
}
const { normalizeShareInput } = load(resolve(__dirname, '../src/main/providers/utils.ts'))
const { baiduPreviewPageUrl } = load(resolve(__dirname, '../src/main/providers/baidu.ts'))
const canonical = 'https://pan.baidu.com/s/1vmq95D6JvpPqXdpegash7Q'
const corrupted = 'https://pan.baidu.com/s/1vmq95D6JvpPqXdp' + canonical

test('recovers the exact concatenated URL reported by the user', () => {
  const result = normalizeShareInput({
    url: `通过网盘分享的文件：FDE\n链接: ${corrupted} 提取码: 7xrg`
  })
  assert.equal(result.url, canonical)
  assert.equal(result.passcode, '7xrg')
})
test('normal share links and embedded passcodes remain intact', () => {
  assert.equal(normalizeShareInput({ url: canonical + '?pwd=7xrg' }).passcode, '7xrg')
  assert.equal(
    normalizeShareInput({ url: 'https://pan.quark.cn/s/abc123' }).url,
    'https://pan.quark.cn/s/abc123'
  )
  assert.equal(normalizeShareInput({ url: canonical + '）' }).url, canonical)
})
test('ambiguous independent URLs and cross-host concatenation are rejected', () => {
  assert.throws(
    () => normalizeShareInput({ url: canonical + ' https://pan.quark.cn/s/abc' }),
    /一个分享链接/
  )
  assert.throws(() => normalizeShareInput({ url: canonical + 'https://example.com/s/abc' }), /拼接/)
})
test('video page uses the parsed share identity and encodes the directory once', () => {
  const path =
    '/sharelink164240693-701618297342494/FDE/【回放】FDE专项转型实战认证培训0912期/01_FDE专项转型实战认证培训-0912（1）.mp4'
  const request = {
    provider: 'baidu',
    shareUrl: corrupted,
    passcode: '7xrg',
    file: { id: '716187606455552', meta: { shortCode: 'vmq95D6JvpPqXdpegash7Q', serverPath: path } }
  }
  const url = new URL(baiduPreviewPageUrl(request))
  assert.equal(url.origin + url.pathname, canonical)
  assert.equal(url.searchParams.get('fid'), request.file.id)
  assert.equal(url.searchParams.get('fpath'), path)
  assert.equal(url.searchParams.get('pwd'), '7xrg')
  assert.equal((url.toString().match(/https:\/\//g) || []).length, 1)
  request.shareUrl = 'https://pan.baidu.com/s/1different'
  assert.equal(new URL(baiduPreviewPageUrl(request)).pathname, '/s/1vmq95D6JvpPqXdpegash7Q')
})
