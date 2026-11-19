import { useEffect, useState } from 'react'
import { App, Button, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { DownloadRequest } from '../../../shared/types'
import { PreviewContent } from './PreviewContent'
import { useAppAppearance } from '../hooks/useAppAppearance'

export function PreviewApp() {
  const [request, setRequest] = useState<DownloadRequest | null>(null)
  const [error, setError] = useState('')
  const dark = useAppAppearance()
  useEffect(() => {
    window.cloudPan
      .previewWindowRequest()
      .then((value) => {
        if (value) setRequest(value)
        else setError('预览信息已失效，请从文件列表重新打开')
      })
      .catch(() => setError('无法读取预览信息，请重新打开'))
  }, [])
  useEffect(() => {
    document.documentElement.classList.add('preview-document')
    return () => document.documentElement.classList.remove('preview-document')
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
      <App>
        {request ? (
          <PreviewContent request={request} />
        ) : (
          <div className="preview-bootstrap">
            <span className="preview-orbit" />
            <p>{error || '正在打开预览'}</p>
            {error && <Button onClick={() => window.cloudPan.closeWindow()}>关闭窗口</Button>}
          </div>
        )}
      </App>
    </ConfigProvider>
  )
}
