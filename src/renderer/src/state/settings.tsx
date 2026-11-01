import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings, Theme } from '../../../shared/types'

const THEME_CACHE = 'siftora-theme'
const lightQuery = window.matchMedia('(prefers-color-scheme: light)')

function applyTheme(theme: Theme, palette: string): void {
  const root = document.documentElement
  root.dataset.theme = theme === 'system' ? (lightQuery.matches ? 'light' : 'dark') : theme
  root.dataset.palette = palette
}

// Paint the last theme before settings load, so a light theme does not flash dark.
try {
  const cached = JSON.parse(localStorage.getItem(THEME_CACHE) ?? 'null') as { theme: Theme; palette: string } | null
  applyTheme(cached?.theme ?? 'system', cached?.palette ?? 'violet')
} catch {
  applyTheme('system', 'violet')
}

interface SettingsContextValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  refresh: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    let alive = true

    window.api
      .getSettings()
      .then((loaded) => {
        if (alive) setSettings(loaded)
      })
      .catch((err: unknown) => {
        window.api.log('error', `getSettings failed: ${String(err)}`)
      })

    return () => {
      alive = false
    }
  }, [])

  const theme = settings?.theme
  const palette = settings?.palette
  useEffect(() => {
    if (!theme || !palette) return
    const apply = (): void => applyTheme(theme, palette)
    apply()
    try {
      localStorage.setItem(THEME_CACHE, JSON.stringify({ theme, palette }))
    } catch {
      // cache is only a startup nicety
    }
    lightQuery.addEventListener('change', apply)
    return () => lightQuery.removeEventListener('change', apply)
  }, [theme, palette])

  if (!settings) return null

  const update = (patch: Partial<Settings>): void => {
    setSettings((current) => (current ? { ...current, ...patch } : current))

    window.api
      .setSettings(patch)
      .then(setSettings)
      .catch((err: unknown) => {
        window.api.log('error', `setSettings failed: ${String(err)}`)
      })
  }

  const refresh = async (): Promise<void> => {
    try {
      setSettings(await window.api.getSettings())
    } catch (err) {
      window.api.log('error', `getSettings failed: ${String(err)}`)
    }
  }

  return (
    <SettingsContext.Provider value={{ settings, update, refresh }}>
      {children}
    </SettingsContext.Provider>
  )
}

/** Build of the user's own llama-server (null = Siftora's own), re-checked when they switch engines. */
export function useOwnLlamaBuild(): number | null {
  const { settings } = useSettings()
  const [build, setBuild] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    window.api
      .ownLlamaBuild()
      .then((value) => alive && setBuild(value))
      .catch((err: unknown) => window.api.log('warn', `ownLlamaBuild failed: ${String(err)}`))
    return () => {
      alive = false
    }
  }, [settings.enginePaths.llama])
  return build
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}
