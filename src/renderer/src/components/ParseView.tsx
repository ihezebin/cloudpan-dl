import { CheckCircleOutlined, CloudOutlined, LinkOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Input, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import type { Provider } from '../../../shared/types'
import { ProviderIcon } from './ProviderIcon'

interface Props {
  detected: Provider | null
  error: string
  onParse: () => void
  onUrlChange: (value: string) => void
  parsing: boolean
  url: string
}

export function ParseView(props: Props) {
  const [emptyError, setEmptyError] = useState('')

  function parse() {
    if (!props.url.trim()) {
      setEmptyError('请先粘贴网盘分享链接')
      return
    }
    setEmptyError('')
    props.onParse()
  }

  function changeUrl(value: string) {
    if (value.trim()) setEmptyError('')
    props.onUrlChange(value)
  }

  const error = emptyError || props.error

  return (
    <section className="hero">
      <div className="hero-icon">
        <CloudOutlined />
      </div>
      <Typography.Title level={1}>粘贴网盘分享链接</Typography.Title>
      <Typography.Paragraph type="secondary">
        自动识别夸克网盘与百度网盘，解析后选择文件下载
      </Typography.Paragraph>
      <Space.Compact className="url-box" block>
        <Input
          autoFocus
          prefix={<LinkOutlined />}
          suffix={
            props.detected && (
              <Tag color={props.detected === 'quark' ? 'purple' : 'blue'}>
                {props.detected === 'quark' ? '夸克' : '百度'}
              </Tag>
            )
          }
          value={props.url}
          onChange={(event) => changeUrl(event.target.value)}
          onPressEnter={parse}
          placeholder="粘贴分享链接（可包含提取码）"
          status={error ? 'error' : undefined}
        />
        <Button type="primary" icon={<SearchOutlined />} loading={props.parsing} onClick={parse}>
          解析链接
        </Button>
      </Space.Compact>
      <div className="parse-error-slot">
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
      </div>
      <Space className="supports" size={12}>
        <Typography.Text type="secondary">支持</Typography.Text>
        <Tag color="purple" className="support-tag">
          <ProviderIcon provider="quark" size={15} />
          夸克网盘
        </Tag>
        <Tag color="blue" className="support-tag">
          <ProviderIcon provider="baidu" size={15} />
          百度网盘
        </Tag>
      </Space>
      <Typography.Text className="privacy" type="secondary">
        <CheckCircleOutlined /> 登录凭证仅保存在本机会话中，不上传第三方服务器
      </Typography.Text>
    </section>
  )
}
