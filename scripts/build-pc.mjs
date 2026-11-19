import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const repository = 'ihezebin/cloudpan-dl'

export function buildPc({
  args = process.argv.slice(2),
  platform = process.platform,
  arch = process.arch,
  cwd = root,
  run = (command, args, options) => spawnSync(command, args, options)
} = {}) {
  if (args.some((arg) => arg !== '--release'))
    throw new Error('用法：node scripts/build-pc.mjs [--release]')
  if (!['darwin', 'win32'].includes(platform))
    throw new Error('PC 安装包请在 macOS 或 Windows 上构建')
  arch = platform === 'win32' ? 'x64' : arch
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`不支持的构建架构：${arch}`)
  const release = args.includes('--release')
  const { name, version } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('打包需要正式版本号，例如 0.1.0')
  const tag = `v${version}`
  const directory = join(
    cwd,
    'release',
    version,
    `${platform === 'win32' ? 'windows' : 'darwin'}-${arch}`
  )
  const execute = (command, args, capture = false) =>
    run(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  const checked = (command, args, label, capture = false) => {
    const result = execute(command, args, capture)
    if (result.error || result.status !== 0)
      throw new Error(
        `${label}失败${result.error ? `：${result.error.message}` : `（退出码 ${result.status ?? result.signal}）`}`
      )
    return result
  }
  const npm = (args) =>
    platform === 'win32'
      ? checked(
          process.env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`],
          'npm'
        )
      : checked('npm', args, 'npm')
  // Check publishing prerequisites before spending time building.
  if (release) {
    checked('gh', ['--version'], '检测 GitHub CLI，请先安装 gh', true)
    checked(
      'gh',
      ['auth', 'status', '--hostname', 'github.com'],
      'GitHub 登录检查，请先执行 gh auth login',
      true
    )
    checked('gh', ['api', `repos/${repository}`], '检查发布仓库访问权限', true)
  }
  if (!existsSync(join(cwd, 'node_modules', 'electron-builder', 'cli.js')))
    npm(existsSync(join(cwd, 'package-lock.json')) ? ['ci'] : ['install', '--package-lock=false'])
  console.log(`Cloudpan PC：${platform} / ${arch}`)
  npm(['run', 'build'])
  checked(
    process.execPath,
    [
      join(cwd, 'node_modules', 'electron-builder', 'cli.js'),
      platform === 'darwin' ? '--mac' : '--win',
      `--${arch}`,
      '--publish',
      'never',
      `--config.directories.output=${directory}`
    ],
    '生成安装包'
  )
  const base = `${name}-${version}`
  const artifacts =
    platform === 'darwin'
      ? [`${base}-mac-${arch}.dmg`, `${base}-mac-${arch}.zip`]
      : [`${base}-win-x64.exe`, `${base}-portable.exe`]
  const files = []
  for (const artifact of artifacts) {
    const path = join(directory, artifact)
    if (!existsSync(path) || !statSync(path).isFile() || !statSync(path).size)
      throw new Error(`缺少安装包：${path}`)
    files.push(path)
    if (existsSync(`${path}.blockmap`)) files.push(`${path}.blockmap`)
  }
  console.log(`安装包已生成：${directory}`)
  if (!release) return
  const lookup = execute('gh', ['api', `repos/${repository}/releases/tags/${tag}`], true)
  if (lookup.status === 0) {
    const info = JSON.parse(lookup.stdout)
    if (info.draft || info.prerelease)
      throw new Error(`${tag} 不是正式 Release，请先检查 GitHub 发布状态`)
  } else if (!lookup.error && /\(HTTP 404\)/.test(lookup.stderr || '')) {
    // Match HLOLT: a missing tag is created at the remote default branch.
    checked(
      'gh',
      ['release', 'create', tag, '--repo', repository, '--title', tag, '--generate-notes'],
      '创建 Release'
    )
  } else throw new Error('查询 Release 失败，请检查网络和仓库访问权限')
  // Only upload this platform's installers, never unpacked applications or old builds.
  for (const file of files)
    checked(
      'gh',
      ['release', 'upload', tag, file, '--repo', repository, '--clobber'],
      '上传发布附件'
    )
  console.log(`发布完成：https://github.com/${repository}/releases/tag/${tag}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    buildPc()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
