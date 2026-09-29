import {
  BgColorsOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  FontSizeOutlined
} from '@ant-design/icons'
import { Button, Drawer, Form, Input, Radio, Select, Segmented, Space, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { APP_FONT_OPTIONS, applyAppFont } from '../fonts/appFont'

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings>({
    defaultDownloadPath: '',
    concurrency: 2,
    maxConcurrency: 2,
    theme: 'system',
    font: 'lxgw_wenkai'
  })

  useEffect(() => {
    if (open) window.cloudPan.getSettings().then(setSettings)
  }, [open])

  async function update(patch: Partial<AppSettings>) {
    const next = await window.cloudPan.updateSettings(patch)
    setSettings(next)
    document.documentElement.dataset.theme = next.theme
    if (patch.font) await applyAppFont(next.font)
  }

  return (
    <Drawer
      rootClassName="settings-drawer"
      title={
        <div className="settings-title">
          <span className="settings-title-icon">
            <DownloadOutlined />
          </span>
          <span>
            <strong>偏好设置</strong>
            <small>定制下载方式与界面外观</small>
          </span>
        </div>
      }
      open={open}
      placement="right"
      width="100%"
      mask={false}
      onClose={onClose}
    >
      <Form className="settings-form">
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-icon">
              <DownloadOutlined />
            </span>
            <span>
              <Typography.Text strong>下载位置</Typography.Text>
              <small>默认下载位置</small>
            </span>
          </div>
          <Space.Compact className="download-path-control settings-row-control">
            <Input readOnly value={settings.defaultDownloadPath} />
            <Button
              icon={<FolderOpenOutlined />}
              onClick={async () => {
                const path = await window.cloudPan.selectDirectory()
                if (path) await update({ defaultDownloadPath: path })
              }}
            >
              选择
            </Button>
          </Space.Compact>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-icon">
              <DownloadOutlined />
            </span>
            <span>
              <Typography.Text strong>同时下载任务</Typography.Text>
              <small>控制并行下载数量</small>
            </span>
          </div>
          <div className="concurrency-control settings-row-control">
            <Typography.Text type="secondary">
              系统 CPU {settings.maxConcurrency} 核，默认按 60% 取{' '}
              {Math.max(1, Math.round(settings.maxConcurrency * 0.6))} 个
            </Typography.Text>
            <Select
              className="settings-select"
              value={settings.concurrency}
              options={Array.from({ length: settings.maxConcurrency }, (_, index) => index + 1).map(
                (value) => ({ value, label: `${value} 个` })
              )}
              onChange={(concurrency) => update({ concurrency })}
            />
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-icon">
              <BgColorsOutlined />
            </span>
            <span>
              <Typography.Text strong>外观</Typography.Text>
              <small>主题模式</small>
            </span>
          </div>
          <Segmented
            className="settings-theme settings-row-control"
            value={settings.theme}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' }
            ]}
            onChange={(theme) => update({ theme: theme as AppSettings['theme'] })}
          />
        </div>
        <div className="settings-row settings-font-row">
          <div className="settings-row-label">
            <span className="settings-row-icon">
              <FontSizeOutlined />
            </span>
            <span>
              <Typography.Text strong>字体</Typography.Text>
              <small>切换后立即应用</small>
            </span>
          </div>
          <Radio.Group
            className="font-choice-grid settings-row-control"
            value={settings.font}
            onChange={(event) => update({ font: event.target.value })}
          >
            {APP_FONT_OPTIONS.map((option) => (
              <Radio.Button
                key={option.key}
                value={option.key}
                style={{ fontFamily: option.family }}
              >
                <strong>{option.label}</strong>
                <small>{option.description}</small>
                <span>{option.preview}</span>
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>
      </Form>
    </Drawer>
  )
}
