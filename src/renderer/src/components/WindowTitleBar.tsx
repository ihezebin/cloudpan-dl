import { useEffect, useState } from 'react'

export function WindowTitleBar() {
  const isWindows = window.cloudPan.platform === 'win32'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isWindows) return
    let active = true
    let changed = false
    const unsubscribe = window.cloudPan.onWindowMaximized((value) => {
      changed = true
      setMaximized(value)
    })
    void window.cloudPan.isWindowMaximized().then((value) => {
      if (active && !changed) setMaximized(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [isWindows])

  return (
    <div className="window-dragbar">
      {isWindows && (
        <div className="window-controls" role="group" aria-label="窗口控制">
          <button
            type="button"
            className="window-control"
            title="最小化"
            aria-label="最小化"
            onClick={() => window.cloudPan.minimizeWindow()}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 6.5h10" />
            </svg>
          </button>
          <button
            type="button"
            className="window-control"
            title={maximized ? '还原' : '最大化'}
            aria-label={maximized ? '还原' : '最大化'}
            onClick={() => window.cloudPan.toggleMaximizeWindow()}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              {maximized ? (
                <path d="M3.5 3.5v-2h7v7h-2 M1.5 3.5h7v7h-7z" />
              ) : (
                <rect x="1.5" y="1.5" width="9" height="9" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="window-control window-control-close"
            title="关闭"
            aria-label="关闭"
            onClick={() => window.cloudPan.closeWindow()}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="m1.5 1.5 9 9m0-9-9 9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
