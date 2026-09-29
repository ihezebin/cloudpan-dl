export type AppFontKey = 'zhuque_fangsong' | 'lxgw_wenkai' | 'xiaolai'

export interface AppFontOption {
  key: AppFontKey
  label: string
  description: string
  preview: string
  family: string
  load?: () => Promise<unknown>
}

export const APP_FONT_OPTIONS: AppFontOption[] = [
  {
    key: 'zhuque_fangsong',
    label: '朱雀仿宋',
    description: '开源仿宋，适合书卷气正文',
    preview: '山高水长，下载从容',
    family: '"Zhuque Fangsong", "STFangsong", "FangSong", "Songti SC", serif',
    load: () => import('@free-fonts/zhuque-fangsong/zhuque-fangsong.css')
  },
  {
    key: 'lxgw_wenkai',
    label: '霞鹜文楷',
    description: '基于 Klee One 的开源楷体',
    preview: '山高水长，下载从容',
    family: '"LXGW WenKai", "Kaiti SC", "KaiTi", "Songti SC", serif',
    load: () =>
      Promise.all([
        import('@hanzi.pro/webfonts-lxgw-wenkai/swap/400.css'),
        import('@hanzi.pro/webfonts-lxgw-wenkai/swap/500.css')
      ])
  },
  {
    key: 'xiaolai',
    label: '小赖字体',
    description: '轻松自然的手写风简体',
    preview: '山高水长，下载从容',
    family: '"Xiaolai SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    load: () => import('@chinese-fonts/xiaolai/dist/Xiaolai/result.css')
  }
]

const loaded = new Set<AppFontKey>()

export async function applyAppFont(key: AppFontKey) {
  const option = APP_FONT_OPTIONS.find((item) => item.key === key) || APP_FONT_OPTIONS[1]
  if (option.load && !loaded.has(option.key)) {
    await option.load()
    loaded.add(option.key)
  }
  document.documentElement.style.setProperty('--app-font-family', option.family)
}
