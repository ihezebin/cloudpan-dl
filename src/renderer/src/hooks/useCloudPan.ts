import { useEffect, useMemo, useState } from 'react'
import type {
  AuthState,
  CloudFile,
  DownloadRequest,
  DownloadTask,
  ParseResult,
  Provider
} from '../../../shared/types'
import { embeddedPasscode } from '../utils/format'

export type AppView = 'home' | 'tasks'

export function useCloudPan() {
  const [url, setUrl] = useState('')
  const [passcode, setPasscode] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [selected, setSelected] = useState<CloudFile[]>([])
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [passcodeError, setPasscodeError] = useState('')
  const [showPasscode, setShowPasscode] = useState(false)
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const [auth, setAuth] = useState<AuthState[]>([])
  const [view, setView] = useState<AppView>('home')

  useEffect(() => {
    window.cloudPan.authStates().then(setAuth)
    window.cloudPan.getTasks().then(setTasks)
    return window.cloudPan.onTasks(setTasks)
  }, [])

  const activeCount = tasks.filter((task) =>
    ['queued', 'preparing', 'downloading', 'paused'].includes(task.status)
  ).length
  const requiresLogin = Boolean(
    result &&
    (auth.find((item) => item.provider === result.provider)?.loggedIn === false ||
      (!auth.some((item) => item.provider === result.provider) && result.requiresLogin))
  )
  const detected = useMemo<Provider | null>(() => {
    try {
      const host = new URL(url.match(/https?:\/\/[^\s]+/)?.[0] || url).hostname
      if (host.includes('quark.cn')) return 'quark'
      if (host.includes('baidu.com')) return 'baidu'
    } catch {
      return null
    }
    return null
  }, [url])

  async function parse(code?: string) {
    if (!url.trim()) return
    setParsing(true)
    setError('')
    try {
      const effectivePasscode = code?.trim() || embeddedPasscode(url) || undefined
      const parsed = await window.cloudPan.parse({ url: url.trim(), passcode: effectivePasscode })
      setPasscode(effectivePasscode || '')
      setShowPasscode(false)
      setPasscodeError('')
      setResult(parsed)
      setSelected([])
      setAuth(await window.cloudPan.authStates())
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      const marker = 'PASSCODE_REQUIRED:'
      if (message.includes(marker)) {
        setPasscodeError(message.slice(message.indexOf(marker) + marker.length))
        setShowPasscode(true)
      } else {
        setError(message)
      }
    } finally {
      setParsing(false)
    }
  }

  async function login(provider: Provider) {
    await window.cloudPan.login(provider)
    setAuth(await window.cloudPan.authStates())
  }

  async function openPage(provider: Provider) {
    await window.cloudPan.openPage(provider)
    setAuth(await window.cloudPan.authStates())
  }

  async function logout(provider: Provider) {
    await window.cloudPan.logout(provider)
    setAuth(await window.cloudPan.authStates())
  }

  async function downloadSelected() {
    if (!result || !selected.length) return
    const items: DownloadRequest[] = selected
      .filter((file) => !file.isFolder)
      .map((file) => ({
        provider: result.provider,
        shareUrl: url,
        passcode: passcode || undefined,
        file
      }))
    await window.cloudPan.addDownloads(items)
    setView('tasks')
  }

  function reset() {
    setResult(null)
    setSelected([])
    setError('')
  }

  return {
    activeCount,
    auth,
    detected,
    downloadSelected,
    error,
    login,
    openPage,
    logout,
    parse,
    parsing,
    passcode,
    passcodeError,
    requiresLogin,
    reset,
    result,
    selected,
    setPasscode,
    setSelected,
    setShowPasscode,
    setUrl,
    setView,
    showPasscode,
    tasks,
    url,
    view
  }
}
