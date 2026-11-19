const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

async function fixture(t, { platform = 'darwin', release = false, failure, lookup } = {}) {
  const { buildPc } = await import('../scripts/build-pc.mjs')
  const cwd = mkdtempSync(join(tmpdir(), 'cloudpan-build-test-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'cloudpan-dl', version: '1.2.3' })
  )
  mkdirSync(join(cwd, 'node_modules/electron-builder'), { recursive: true })
  writeFileSync(join(cwd, 'node_modules/electron-builder/cli.js'), '')
  const calls = []
  const run = (command, args) => {
    calls.push({ command, args })
    if (failure?.(command, args)) return { status: 1 }
    if (command === process.execPath) {
      const directory = args
        .find((x) => x.startsWith('--config.directories.output='))
        .split('=')
        .slice(1)
        .join('=')
      mkdirSync(directory, { recursive: true })
      const files =
        platform === 'darwin'
          ? ['cloudpan-dl-1.2.3-mac-arm64.dmg', 'cloudpan-dl-1.2.3-mac-arm64.zip']
          : ['cloudpan-dl-1.2.3-win-x64.exe', 'cloudpan-dl-1.2.3-portable.exe']
      for (const file of [...files, 'old-version.exe', 'builder-debug.yml'])
        writeFileSync(join(directory, file), 'fixture')
    }
    if (args[0] === 'api' && args[1].includes('/releases/tags/'))
      return lookup || { status: 1, stderr: 'gh: Not Found (HTTP 404)' }
    return { status: 0, stdout: '{}' }
  }
  return {
    calls,
    execute: () =>
      buildPc({ cwd, platform, arch: 'arm64', args: release ? ['--release'] : [], run })
  }
}

test('local mac build never calls GitHub and separates version/platform output', async (t) => {
  const f = await fixture(t)
  f.execute()
  assert.equal(
    f.calls.some((x) => x.command === 'gh'),
    false
  )
  const build = f.calls.find((x) => x.command === process.execPath)
  assert.ok(build.args.includes('--arm64'))
  assert.ok(build.args.some((x) => x.endsWith('/release/1.2.3/darwin-arm64')))
})
test('Windows release uses x64 and uploads only current installers', async (t) => {
  const f = await fixture(t, { platform: 'win32', release: true })
  f.execute()
  assert.ok(f.calls.find((x) => x.command === process.execPath).args.includes('--x64'))
  const uploads = f.calls.filter((x) => x.args[0] === 'release' && x.args[1] === 'upload')
  assert.equal(uploads.length, 2)
  assert.ok(
    uploads.every((x) => x.args.includes('ihezebin/cloudpan-dl') && x.args.includes('--clobber'))
  )
  assert.ok(!uploads.some((x) => x.args.some((a) => /old-version|builder-debug/.test(a))))
})
test('failed authentication stops before building', async (t) => {
  const f = await fixture(t, { release: true, failure: (_c, args) => args[0] === 'auth' })
  assert.throws(f.execute, /登录检查/)
  assert.equal(
    f.calls.some((x) => x.command === process.execPath || x.command === 'npm'),
    false
  )
})
test('failed build does not publish', async (t) => {
  const f = await fixture(t, { release: true, failure: (c) => c === process.execPath })
  assert.throws(f.execute, /生成安装包/)
  assert.equal(
    f.calls.some((x) => x.args[0] === 'release'),
    false
  )
})
test('non-404 release lookup failures never create a release', async (t) => {
  const f = await fixture(t, { release: true, lookup: { status: 1, stderr: 'HTTP 503' } })
  assert.throws(f.execute, /查询 Release/)
  assert.equal(
    f.calls.some((x) => x.args[0] === 'release'),
    false
  )
})
