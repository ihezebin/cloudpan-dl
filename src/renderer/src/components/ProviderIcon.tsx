import type { Provider } from '../../../shared/types'

export function ProviderIcon({ provider, size = 18 }: { provider: Provider; size?: number }) {
  return (
    <span className={`provider-icon ${provider}-icon`} style={{ width: size, height: size }}>
      <img
        src={
          provider === 'quark'
            ? 'https://pan.quark.cn/favicon.ico'
            : 'https://nd-static.bdstatic.com/m-static/wp-brand/favicon.ico'
        }
        alt={provider === 'quark' ? '夸克网盘' : '百度网盘'}
      />
    </span>
  )
}
