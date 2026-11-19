const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function providerWith(fetch) {
  function load(filename) {
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const exports = {}
    runInNewContext(source, {
      exports,
      URL,
      URLSearchParams,
      AbortSignal,
      require(name) {
        if (name === 'electron') return {}
        if (name === './session')
          return {
            cloudSession: () => ({ fetch, cookies: { get: async () => [] } }),
            isLoggedIn: async () => true,
            USER_AGENT: 'test'
          }
        return load(resolve(dirname(filename), `${name}.ts`))
      }
    })
    return exports
  }
  return new (load(resolve(__dirname, '../src/main/providers/baidu.ts')).BaiduProvider)()
}

const context = {
  shareId: '28910385887',
  shareUk: '164240693',
  shortCode: 'vmq95D6JvpPqXdpegash7Q'
}
const folder = {
  id: '1',
  name: 'FDE',
  isFolder: true,
  meta: { ...context, serverPath: '/课程/FDE' }
}
const response = (payload, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => payload
})

test('parse retains absolute paths and share context for browsing', async () => {
  const provider = providerWith(async () => ({
    url: 'https://pan.baidu.com/s/1example',
    text: async () =>
      `locals.mset(${JSON.stringify({
        shareid: context.shareId,
        share_uk: context.shareUk,
        file_list: [{ fs_id: 1, server_filename: 'FDE', isdir: 1, path: '/课程/FDE' }]
      })})`
  }))
  const result = await provider.parse({ url: 'https://pan.baidu.com/s/1example' })
  assert.equal(result.files[0].meta.serverPath, '/课程/FDE')
  assert.equal(result.files[0].meta.shareId, context.shareId)
  assert.equal(result.files[0].isFolder, true)
})

test('folder listing paginates and carries paths and download parameters into nested folders', async () => {
  const calls = []
  const provider = providerWith(async (url, init) => {
    const query = new URL(url).searchParams
    calls.push(query)
    assert.equal(init.credentials, 'include')
    assert.equal(query.get('shareid'), context.shareId)
    assert.equal(query.get('uk'), context.shareUk)
    assert.equal(query.get('root'), '0')
    if (query.get('dir') === '/课程/FDE/子目录') {
      return response({
        errno: 0,
        list: [
          {
            fs_id: 102,
            server_filename: '课件.pdf',
            size: 12,
            isdir: 0,
            path: '/课程/FDE/子目录/课件.pdf'
          }
        ]
      })
    }
    assert.equal(query.get('dir'), '/课程/FDE')
    return response({
      errno: 0,
      list:
        query.get('page') === '1'
          ? Array.from({ length: 100 }, (_, i) => ({
              fs_id: i + 2,
              server_filename: `视频${i}.mp4`,
              isdir: 0
            }))
          : [{ fs_id: 101, server_filename: '子目录', isdir: '1', path: '/课程/FDE/子目录' }]
    })
  })
  const files = await provider.listFolder(folder)
  assert.equal(files.length, 101)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].get('page'), '2')
  const nested = files[100]
  assert.equal(nested.isFolder, true)
  assert.equal(nested.path, 'FDE')
  const [file] = await provider.listFolder(nested)
  assert.equal(file.path, 'FDE/子目录')
  assert.equal(file.kind, 'document')
  for (const [key, value] of Object.entries(context)) assert.equal(file.meta[key], value)
})

test('empty directories succeed while malformed and rejected responses report errors', async () => {
  assert.equal(
    (await providerWith(async () => response({ errno: 0, list: [] })).listFolder(folder)).length,
    0
  )
  for (const [payload, pattern] of [
    [{ errno: 9019 }, /提取码/],
    [{ errno: -9 }, /提取码/],
    [{ errno: -6 }, /重新登录/],
    [{ errno: 112 }, /重新登录/],
    [{ errno: 2, errmsg: '分享已取消' }, /分享已取消/],
    [{ errno: 0 }, /未返回目录列表/]
  ]) {
    await assert.rejects(providerWith(async () => response(payload)).listFolder(folder), pattern)
  }
  await assert.rejects(
    providerWith(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('HTML')
      }
    })).listFolder(folder),
    /HTTP 502/
  )
})

test('missing absolute path fails before making a request', async () => {
  const provider = providerWith(async () => assert.fail('must not fetch without a server path'))
  await assert.rejects(provider.listFolder({ ...folder, meta: context }), /重新解析/)
})

test('parse supports the current locals-data JSON share page', async () => {
  const provider = providerWith(async () => ({
    url: 'https://pan.baidu.com/s/1example',
    text: async () =>
      `<script id="locals-data" type="application/json">${JSON.stringify({
        shareid: context.shareId,
        share_uk: context.shareUk,
        file_list: [{ fs_id: 1, server_filename: 'FDE', isdir: 1, path: '/课程/FDE' }]
      })}</script>`
  }))
  const result = await provider.parse({ url: 'https://pan.baidu.com/s/1example' })
  assert.equal(result.files[0].meta.shareId, context.shareId)
  assert.equal(result.files[0].meta.shareUk, context.shareUk)
  assert.equal(result.files[0].meta.serverPath, '/课程/FDE')
})

test('download signatures use the full surl for the current Baidu page API', async () => {
  const provider = providerWith(async (url, options) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/share/tplconfig') {
      assert.equal(parsed.searchParams.get('surl'), `1${context.shortCode}`)
      assert.equal(parsed.searchParams.get('shareid'), context.shareId)
      assert.equal(options.credentials, 'include')
      return response({ errno: 0, data: { sign: 'fixture-sign', timestamp: 123 } })
    }
    assert.equal(parsed.pathname, '/api/sharedownload')
    assert.equal(parsed.searchParams.get('sign'), 'fixture-sign')
    return response({ errno: 0, list: [{ dlink: 'https://pan.baidu.com/file' }] })
  })
  const url = await provider.resolveDownloadUrl({
    provider: 'baidu',
    shareUrl: 'https://pan.baidu.com/s/1example',
    file: { id: '123', meta: context }
  })
  assert.equal(url, 'https://pan.baidu.com/file')
})

test('encrypted share responses report the missing direct link instead of error code zero', async () => {
  const provider = providerWith(async (url) =>
    new URL(url).pathname === '/share/tplconfig'
      ? response({ errno: 0, data: { sign: 'fixture', timestamp: 1 } })
      : response({ errno: 0, list: 'encrypted-response' })
  )
  await assert.rejects(
    provider.resolveDownloadUrl({
      provider: 'baidu',
      shareUrl: 'https://pan.baidu.com/s/1example',
      file: { id: '123', meta: context }
    }),
    /未提供.*分享下载直链/
  )
})

test('file requests use an origin referrer accepted by Chromium across CDN redirects', () => {
  const provider = providerWith(() => {
    throw new Error('No network expected')
  })
  assert.equal(
    provider.downloadHeaders({ shareUrl: 'https://pan.baidu.com/s/example' }).referer,
    'https://pan.baidu.com/'
  )
})
