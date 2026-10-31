import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '../../../shared/types'

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

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}
