import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { HardwareInfo, ModelState, Recommendation } from '../../../shared/types'

interface ModelsContextValue {
  models: Record<string, ModelState>
  hardware: HardwareInfo | null
  recommendation: Recommendation | null
  download: (ids: string[]) => void
  cancel: (id: string) => void
  remove: (id: string) => void
}

const ModelsContext = createContext<ModelsContextValue | null>(null)

export function ModelsProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<Record<string, ModelState>>({})
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)

  useEffect(() => {
    let alive = true

    window.api
      .listModels()
      .then((list) => {
        if (!alive) return
        setModels(Object.fromEntries(list.map((state) => [state.id, state])))
      })
      .catch((err: unknown) => {
        window.api.log('error', `listModels failed: ${String(err)}`)
      })

    window.api
      .getHardware()
      .then((info) => {
        if (alive) setHardware(info)
      })
      .catch((err: unknown) => {
        window.api.log('error', `getHardware failed: ${String(err)}`)
      })

    window.api
      .getRecommendation()
      .then((result) => {
        if (alive) setRecommendation(result)
      })
      .catch((err: unknown) => {
        window.api.log('error', `getRecommendation failed: ${String(err)}`)
      })

    const unsubscribe = window.api.onModelState((state) => {
      setModels((current) => ({ ...current, [state.id]: state }))
    })

    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const download = (ids: string[]): void => {
    window.api.downloadModels(ids).catch((err: unknown) => {
      window.api.log('error', `downloadModels failed: ${String(err)}`)
    })
  }

  const cancel = (id: string): void => {
    window.api.cancelDownload(id).catch((err: unknown) => {
      window.api.log('error', `cancelDownload failed: ${String(err)}`)
    })
  }

  const remove = (id: string): void => {
    window.api.deleteModel(id).catch((err: unknown) => {
      window.api.log('error', `deleteModel failed: ${String(err)}`)
    })
  }

  return (
    <ModelsContext.Provider value={{ models, hardware, recommendation, download, cancel, remove }}>
      {children}
    </ModelsContext.Provider>
  )
}

export function useModels(): ModelsContextValue {
  const value = useContext(ModelsContext)
  if (!value) throw new Error('useModels must be used inside ModelsProvider')
  return value
}
