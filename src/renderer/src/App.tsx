import { useEffect, useState } from 'react'
import { App as AntdApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppHeader } from './components/AppHeader'
import { FileBrowser } from './components/FileBrowser'
import { ParseView } from './components/ParseView'
import { PasscodeModal } from './components/PasscodeModal'
import { SettingsModal } from './components/SettingsModal'
import { TaskView } from './components/TaskView'
import { useCloudPan } from './hooks/useCloudPan'
import { applyAppFont } from './fonts/appFont'

function AppContent() {
  const cloud = useCloudPan()
  const [showSettings, setShowSettings] = useState(false)
  const [dark, setDark] = useState(false)
  const isMac = navigator.userAgent.includes('Mac')

  useEffect(() => {
    window.cloudPan.getSettings().then((settings) => {
      document.documentElement.dataset.theme = settings.theme
      setDark(settings.theme === 'dark')
      void applyAppFont(settings.font)
    })
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark')
    )
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => observer.disconnect()
  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 10,
          fontFamily: 'var(--app-font-family)',
          ...(dark
            ? {
                colorBgBase: '#0f172a',
                colorBgContainer: '#172033',
                colorBgElevated: '#1b2638',
                colorBorder: '#334155',
                colorBorderSecondary: '#273449',
                colorText: '#e5edf7',
                colorTextSecondary: '#94a3b8'
              }
            : {})
        }
      }}
    >
      <AntdApp>
        <div className={`app-shell ${isMac ? 'macos' : ''}`}>
          {isMac && <div className="window-dragbar" aria-hidden="true" />}
          <AppHeader
            activeCount={cloud.activeCount}
            auth={cloud.auth}
            view={cloud.view}
            onOpenPage={cloud.openPage}
            onLogout={cloud.logout}
            onOpenSettings={() => setShowSettings(true)}
            onViewChange={cloud.setView}
          />
          <main>
            {cloud.view === 'home' && !cloud.result && (
              <ParseView
                detected={cloud.detected}
                error={cloud.error}
                parsing={cloud.parsing}
                url={cloud.url}
                onParse={() => cloud.parse()}
                onUrlChange={cloud.setUrl}
              />
            )}
            {cloud.view === 'home' && cloud.result && (
              <FileBrowser
                result={cloud.result}
                selected={cloud.selected}
                requiresLogin={cloud.requiresLogin}
                onBack={cloud.reset}
                onDownload={cloud.downloadSelected}
                onLogin={cloud.login}
                onSelectionChange={cloud.setSelected}
              />
            )}
            {cloud.view === 'tasks' && (
              <TaskView tasks={cloud.tasks} onGoHome={() => cloud.setView('home')} />
            )}
          </main>
          <PasscodeModal
            open={cloud.showPasscode}
            value={cloud.passcode}
            error={cloud.passcodeError}
            loading={cloud.parsing}
            onCancel={() => cloud.setShowPasscode(false)}
            onChange={cloud.setPasscode}
            onSubmit={() => cloud.parse(cloud.passcode)}
          />
          <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
        </div>
      </AntdApp>
    </ConfigProvider>
  )
}

export default AppContent
