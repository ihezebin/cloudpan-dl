import type { Provider } from '../../shared/types'

export interface ProviderConfig {
  label: string
  loginUrl: string
  cookieNames: string[]
  hosts: string[]
}

export const providerConfig: Record<Provider, ProviderConfig> = {
  quark: {
    label: '夸克网盘',
    loginUrl: 'https://pan.quark.cn/',
    cookieNames: ['__puus'],
    hosts: ['quark.cn']
  },
  baidu: {
    label: '百度网盘',
    loginUrl: 'https://pan.baidu.com/',
    cookieNames: ['BDUSS'],
    hosts: ['baidu.com', 'baidupcs.com']
  }
}
