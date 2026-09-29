import {
  ArrowLeftOutlined,
  DownloadOutlined,
  FileFilled,
  FolderFilled,
  LoginOutlined,
  LogoutOutlined,
  SearchOutlined,
  VideoCameraFilled
} from '@ant-design/icons'
import { Alert, App, Breadcrumb, Button, Input, message, Space, Table, Tag, Typography } from 'antd'
import type { Key } from 'react'
import { useMemo, useState } from 'react'
import type { CloudFile, FileKind, ParseResult, Provider } from '../../../shared/types'
import { formatBytes } from '../utils/format'
import { ProviderIcon } from './ProviderIcon'

const kindLabels: Record<FileKind, string> = {
  archive: '压缩包',
  audio: '音频',
  document: '文档',
  folder: '文件夹',
  image: '图片',
  other: '文件',
  video: '视频'
}

function fileIcon(file: CloudFile) {
  if (file.isFolder) return <FolderFilled />
  if (file.kind === 'video') return <VideoCameraFilled />
  return <FileFilled />
}

interface Props {
  onBack: () => void
  onDownload: () => void
  onLogin: (provider: Provider) => void
  onSelectionChange: (files: CloudFile[]) => void
  requiresLogin: boolean
  result: ParseResult
  selected: CloudFile[]
}

export function FileBrowser(props: Props) {
  const { modal } = App.useApp()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState(props.result.files)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<Array<{ name: string; files: CloudFile[] }>>([])
  const visibleFiles = useMemo(
    () => files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase())),
    [files, query]
  )
  const selectedIds = useMemo(
    () => new Set(props.selected.map((file) => file.id)),
    [props.selected]
  )

  async function openFolder(folder: CloudFile) {
    setLoading(true)
    try {
      const children = await window.cloudPan.listFolder(props.result.provider, folder)
      setHistory((current) => [...current, { name: folder.name, files }])
      setFiles(children)
      setQuery('')
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  function goToLevel(index: number) {
    if (index === 0) {
      setFiles(props.result.files)
      setHistory([])
    } else {
      setFiles(history[index].files)
      setHistory((current) => current.slice(0, index))
    }
  }

  function goBack() {
    if (!history.length) {
      modal.confirm({
        title: '退出当前链接？',
        content: '退出后将回到解析页面，需要重新解析网盘分享链接。',
        okText: '退出并返回',
        cancelText: '继续浏览',
        okButtonProps: { icon: <LogoutOutlined /> },
        cancelButtonProps: { icon: <ArrowLeftOutlined /> },
        centered: true,
        onOk: props.onBack
      })
      return
    }
    const previous = history[history.length - 1]
    setFiles(previous.files)
    setHistory((current) => current.slice(0, -1))
    setQuery('')
  }

  function toggle(file: CloudFile) {
    if (file.isFolder) return
    if (selectedIds.has(file.id)) {
      props.onSelectionChange(props.selected.filter((item) => item.id !== file.id))
    } else {
      props.onSelectionChange([...props.selected, file])
    }
  }

  function updateVisibleSelection(keys: Key[]) {
    const visibleIds = new Set(visibleFiles.map((file) => file.id))
    const nextIds = new Set(keys.map(String))
    const retained = props.selected.filter((file) => !visibleIds.has(file.id))
    const added = visibleFiles.filter((file) => nextIds.has(file.id) && !file.isFolder)
    props.onSelectionChange([...retained, ...added])
  }

  return (
    <section className="content-page">
      <div className="page-heading">
        <div className={`source-logo ${props.result.provider}`}>
          <ProviderIcon provider={props.result.provider} size={25} />
        </div>
        <div className="source-title">
          <Typography.Title level={4}>{props.result.title}</Typography.Title>
          <Typography.Text type="secondary">
            {props.result.provider === 'quark' ? '夸克网盘' : '百度网盘'} · 当前目录 {files.length}{' '}
            项
          </Typography.Text>
        </div>
        <Space className="heading-actions">
          <Button className="directory-back" icon={<ArrowLeftOutlined />} onClick={goBack}>
            返回
          </Button>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索当前目录"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            disabled={!props.selected.length || props.requiresLogin}
            onClick={props.onDownload}
          >
            下载所选 ({props.selected.length})
          </Button>
        </Space>
      </div>
      <Breadcrumb
        className="folder-breadcrumb"
        items={[
          { title: <a onClick={() => goToLevel(0)}>分享根目录</a> },
          ...history.map((item, index) => ({
            title:
              index === history.length - 1 ? (
                item.name
              ) : (
                <a onClick={() => goToLevel(index + 1)}>{item.name}</a>
              )
          }))
        ]}
      />
      {props.requiresLogin && (
        <Alert
          className="login-alert"
          type="warning"
          showIcon
          icon={<LoginOutlined />}
          message={`下载前请先登录自己的${props.result.provider === 'quark' ? '夸克网盘' : '百度网盘'}账号`}
          action={
            <Button
              size="small"
              type="link"
              icon={<LoginOutlined />}
              onClick={() => props.onLogin(props.result.provider)}
            >
              现在登录
            </Button>
          }
        />
      )}
      <Table<CloudFile>
        className="file-table"
        rowKey="id"
        dataSource={visibleFiles}
        loading={loading}
        pagination={false}
        scroll={{ y: 'calc(100vh - 320px)' }}
        rowSelection={{
          selectedRowKeys: [...selectedIds],
          onChange: updateVisibleSelection,
          getCheckboxProps: (file) => ({ disabled: file.isFolder })
        }}
        onRow={(file) => ({
          className: file.isFolder ? 'folder-table-row' : 'file-table-row',
          onClick: () => (file.isFolder ? openFolder(file) : toggle(file))
        })}
        columns={[
          {
            title: '文件名',
            dataIndex: 'name',
            ellipsis: true,
            render: (_, file) => (
              <div className="file-name-cell">
                <span className={`file-icon ${file.kind}`}>{fileIcon(file)}</span>
                <span>
                  <strong>{file.name}</strong>
                  {file.path && <small>{file.path}</small>}
                </span>
              </div>
            )
          },
          {
            title: '大小',
            dataIndex: 'size',
            width: 130,
            render: (size, file) => (file.isFolder ? '—' : formatBytes(size))
          },
          {
            title: '类型',
            dataIndex: 'kind',
            width: 110,
            render: (kind: FileKind) => <Tag>{kindLabels[kind]}</Tag>
          }
        ]}
      />
    </section>
  )
}
