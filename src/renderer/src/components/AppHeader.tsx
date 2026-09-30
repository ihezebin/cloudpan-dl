import { useState } from 'react'
import { CloudOutlined, DownloadOutlined, LinkOutlined, SettingOutlined } from '@ant-design/icons'
import { App, Badge, Button, Popover, Segmented, Space, Tag } from 'antd'
import type { AuthState, Provider } from '../../../shared/types'
import type { AppView } from '../hooks/useCloudPan'
import { ProviderIcon } from './ProviderIcon'

interface Props {
  activeCount: number
  auth: AuthState[]
  onOpenPage: (provider: Provider) => Promise<void>
  onLogout: (provider: Provider) => Promise<void>
  onOpenSettings: () => void
  onViewChange: (view: AppView) => void
  view: AppView
}

export function AppHeader(props: Props) {
  const { modal } = App.useApp()
  const [openProvider, setOpenProvider] = useState<Provider | null>(null)

  function confirmLogout(provider: Provider, label: string) {
    setOpenProvider(null)
    modal.confirm({
      title: `退出${label}登录？`,
      content: '退出后，需要重新登录才能使用该账号下载。',
      okText: '退出登录',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => props.onLogout(provider)
    })
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <CloudOutlined />
        </span>
        <span>云盘提速下载器</span>
      </div>
      <Segmented
        value={props.view}
        onChange={(value) => props.onViewChange(value as AppView)}
        options={[
          {
            value: 'home',
            label: (
              <Space size={6}>
                <LinkOutlined />
                解析
              </Space>
            )
          },
          {
            value: 'tasks',
            label: (
              <Space size={6}>
                <DownloadOutlined />
                下载
                <Badge count={props.activeCount} size="small" />
              </Space>
            )
          }
        ]}
      />
      <Space className="top-actions" size={8}>
        {props.auth.map((item) => (
          <Popover
            key={item.provider}
            trigger="click"
            open={openProvider === item.provider}
            onOpenChange={(open) => setOpenProvider(open ? item.provider : null)}
            content={
              <Space size={8}>
                <Button
                  onClick={() => {
                    setOpenProvider(null)
                    props.onOpenPage(item.provider)
                  }}
                >
                  打开网盘页面
                </Button>
                <Button
                  danger
                  disabled={!item.hasSession}
                  onClick={() => confirmLogout(item.provider, item.label)}
                >
                  退出登录
                </Button>
              </Space>
            }
          >
            <Tag color={item.loggedIn ? 'success' : 'default'} className="auth-tag">
              <ProviderIcon provider={item.provider} size={16} />
              {item.label}
              {item.loggedIn ? '已登录' : item.hasSession ? '检查账号' : '登录'}
            </Tag>
          </Popover>
        ))}
        <Button
          type="text"
          shape="circle"
          icon={<SettingOutlined />}
          onClick={props.onOpenSettings}
        />
      </Space>
    </header>
  )
}
