export function formatBytes(value: number) {
  if (!value) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit > 1 ? 2 : 1)} ${units[unit]}`
}

export function embeddedPasscode(value: string) {
  return (
    value.match(/[?&#](?:pwd|passcode|code)=([a-zA-Z0-9]{4,12})/i)?.[1] ||
    value.match(/(?:提取码|访问码|密码)\s*[:：]?\s*([a-zA-Z0-9]{4,12})/i)?.[1] ||
    ''
  )
}
