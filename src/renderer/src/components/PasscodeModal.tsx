import { CloseOutlined, LockOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Input, Modal } from 'antd'

interface Props {
  error: string
  loading: boolean
  onCancel: () => void
  onChange: (value: string) => void
  onSubmit: () => void
  open: boolean
  value: string
}

export function PasscodeModal(props: Props) {
  return (
    <Modal
      title="请输入提取码"
      open={props.open}
      okText="继续解析"
      cancelText="取消"
      confirmLoading={props.loading}
      okButtonProps={{ disabled: !props.value.trim(), icon: <SearchOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={props.onCancel}
      onOk={props.onSubmit}
      destroyOnHidden
    >
      <p className="modal-description">平台确认该分享需要提取码才能继续解析。</p>
      <Input
        autoFocus
        prefix={<LockOutlined />}
        value={props.value}
        maxLength={12}
        placeholder="提取码"
        onChange={(event) => props.onChange(event.target.value)}
        onPressEnter={props.onSubmit}
      />
      {props.error && <Alert className="modal-alert" type="error" showIcon message={props.error} />}
    </Modal>
  )
}
