import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { applyAppFont } from '../fonts/appFont'

export function useAppAppearance() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    let selected: AppSettings['theme'] = 'system'
    const applyTheme = () => {
      const isDark = selected === 'dark' || (selected === 'system' && system.matches)
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
      setDark(isDark)
    }
    const apply = (settings: AppSettings) => {
      selected = settings.theme
      applyTheme()
      void applyAppFont(settings.font)
    }
    let active = true
    const unsubscribe = window.cloudPan.onSettingsChanged(apply)
    void window.cloudPan.getSettings().then((settings) => {
      if (active) apply(settings)
    })
    system.addEventListener('change', applyTheme)
    return () => {
      active = false
      unsubscribe()
      system.removeEventListener('change', applyTheme)
    }
  }, [])
  return dark
}
