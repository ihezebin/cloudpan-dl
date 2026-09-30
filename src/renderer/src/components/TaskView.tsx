import {
  CloseOutlined,
  DeleteOutlined,
  CloudDownloadOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PauseOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import { Button, Empty, Popconfirm, Progress, Space, Tag, Tooltip, Typography } from 'antd'
import type { DownloadTask } from '../../../shared/types'
import { formatBytes } from '../utils/format'

const statusLabels: Record<DownloadTask['status'], string> = {
  cancelled: '已取消',
  completed: '已完成',
  downloading: '下载中',
  failed: '失败',
  paused: '已暂停',
  preparing: '准备中',
  queued: '等待中'
}

export function TaskView({ tasks, onGoHome }: { tasks: DownloadTask[]; onGoHome: () => void }) {
  return (
    <section className="content-page tasks-page">
      <div className="section-title">
        <Typography.Title level={3}>下载任务</Typography.Title>
        <Typography.Text type="secondary">
          {tasks.filter((task) => task.status === 'completed').length} 个已完成
        </Typography.Text>
      </div>
      {!tasks.length ? (
        <div className="task-empty-card">
          <Empty
            image={
              <div className="task-empty-illustration">
                <span />
                <CloudDownloadOutlined />
              </div>
            }
            description={
              <div className="task-empty-copy">
                <strong>还没有下载任务</strong>
                <span>解析网盘分享链接，选择文件后即可开始下载</span>
              </div>
            }
          >
            <Button type="primary" size="large" icon={<LinkOutlined />} onClick={onGoHome}>
              去解析链接
            </Button>
          </Empty>
        </div>
      ) : (
        <div className="task-list">
          {tasks.map((task) => {
            const progress =
              task.status === 'completed'
                ? 100
                : task.size
                  ? Math.min(100, (task.received / task.size) * 100)
                  : 0
            return (
              <div className="task" key={task.id}>
                <div className="task-main">
                  <div className="task-title">
                    <div className="task-title-main">
                      <strong>{task.fileName}</strong>
                      <Tag color={task.provider === 'quark' ? 'blue' : 'geekblue'}>
                        {task.provider === 'quark' ? '夸克' : '百度'}
                      </Tag>
                      {task.viaTransfer && <Tag color="orange">已转存</Tag>}
                    </div>
                    <span className="task-status">
                      {task.status === 'downloading'
                        ? `${formatBytes(task.speed)}/s`
                        : statusLabels[task.status]}
                    </span>
                  </div>
                  <Progress
                    percent={Number(progress.toFixed(1))}
                    size="small"
                    status={
                      task.status === 'failed'
                        ? 'exception'
                        : task.status === 'completed'
                          ? 'success'
                          : 'active'
                    }
                  />
                  <div className="task-meta">
                    <div className="task-meta-copy">
                      <span>
                        {formatBytes(task.received)} / {formatBytes(task.size)}
                      </span>
                      {task.error && <em>{task.error}</em>}
                    </div>
                    <Space className="task-actions" size={6}>
                      {['downloading', 'preparing'].includes(task.status) && (
                        <Tooltip title="暂停下载">
                          <Button
                            className="task-action-primary"
                            type="text"
                            icon={<PauseOutlined />}
                            onClick={() => window.cloudPan.taskAction(task.id, 'pause')}
                          />
                        </Tooltip>
                      )}
                      {['paused', 'failed'].includes(task.status) && (
                        <Tooltip title="继续下载">
                          <Button
                            className="task-action-primary"
                            type="text"
                            icon={<PlayCircleOutlined />}
                            onClick={() => window.cloudPan.taskAction(task.id, 'resume')}
                          />
                        </Tooltip>
                      )}
                      {task.status === 'completed' && (
                        <Tooltip title="在访达中显示">
                          <Button
                            type="text"
                            icon={<FolderOpenOutlined />}
                            onClick={() => window.cloudPan.taskAction(task.id, 'open')}
                          />
                        </Tooltip>
                      )}
                      {!['completed', 'cancelled'].includes(task.status) && (
                        <Popconfirm
                          title="确定取消这个下载任务？"
                          description="取消后将停止当前下载。"
                          okText="确定取消"
                          cancelText="继续下载"
                          okButtonProps={{ danger: true, icon: <CloseOutlined /> }}
                          cancelButtonProps={{ icon: <CloudDownloadOutlined /> }}
                          onConfirm={() => window.cloudPan.taskAction(task.id, 'cancel')}
                        >
                          <Tooltip title="取消任务">
                            <Button
                              className="task-action-cancel"
                              type="text"
                              icon={<CloseOutlined />}
                            />
                          </Tooltip>
                        </Popconfirm>
                      )}
                      <Popconfirm
                        title="删除这条任务记录？"
                        description="已下载的本地文件不会被删除。"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true, icon: <DeleteOutlined /> }}
                        cancelButtonProps={{ icon: <CloseOutlined /> }}
                        onConfirm={() => window.cloudPan.taskAction(task.id, 'delete')}
                      >
                        <Tooltip title="删除记录">
                          <Button type="text" danger icon={<DeleteOutlined />} />
                        </Tooltip>
                      </Popconfirm>
                    </Space>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
