import { CloudOutlined, DownloadOutlined, LinkOutlined, SettingOutlined } from '@ant-design/icons'
import { Badge, Button, Segmented, Space, Tag } from 'antd'
import type { AuthState, Provider } from '../../../shared/types'
import type { AppView } from '../hooks/useCloudPan'
import { ProviderIcon } from './ProviderIcon'

interface Props {
  activeCount: number
  auth: AuthState[]
  onLogin: (provider: Provider) => void
  onOpenSettings: () => void
  onViewChange: (view: AppView) => void
  view: AppView
}

export function AppHeader(props: Props) {
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
          <Tag
            key={item.provider}
            color={item.loggedIn ? 'success' : 'default'}
            className="auth-tag"
            onClick={() => props.onLogin(item.provider)}
          >
            <ProviderIcon provider={item.provider} size={16} />
            {item.label}
            {item.loggedIn ? '已登录' : '登录'}
          </Tag>
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
