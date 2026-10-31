import { useState } from 'react'
import type { ScannedModel } from '../../../shared/types'
import { formatBytes } from '../lib/format'
import { useSettings } from '../state/settings'

export default function ExistingModels() {
  const { refresh } = useSettings()
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<ScannedModel[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scan = async (): Promise<void> => {
    setScanning(true)
    setError(null)
    try {
      setScanned(await window.api.scanForModels())
    } catch (err) {
      setError('Could not scan for models. Try again.')
      window.api.log('error', `scanForModels failed: ${String(err)}`)
    } finally {
      setScanning(false)
    }
  }

  const add = async (path: string, name?: string): Promise<void> => {
    setBusy(path)
    setError(null)
    try {
      const result = await window.api.addCustomModel(path, name)
      if (result.error) {
        setError(result.error)
      } else {
        setScanned((current) => current?.filter((model) => model.path !== path) ?? null)
        await refresh()
      }
    } catch (err) {
      setError('Could not add that model file.')
      window.api.log('error', `addCustomModel failed: ${String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  const choose = async (): Promise<void> => {
    try {
      const path = await window.api.pickModelFile()
      if (path) await add(path)
    } catch (err) {
      setError('Could not open the file picker.')
      window.api.log('error', `pickModelFile failed: ${String(err)}`)
    }
  }

  return (
    <div>
      <div className="actions">
        <button type="button" className="button" disabled={scanning} onClick={() => void scan()}>
          {scanning ? 'Scanning…' : 'Find models already on this computer'}
        </button>
        <button type="button" className="button" disabled={busy !== null} onClick={() => void choose()}>
          Choose a model file…
        </button>
      </div>

      {scanned ? (
        scanned.length > 0 ? (
          <ul className="file-list">
            {scanned.map((model) => (
              <li className="file-item" key={model.path}>
                <div className="file-name">
                  {model.name}
                  <span className="tag">{model.source}</span>
                  <span className="muted">
                    {' '}
                    · {formatBytes(model.bytes)} ·{' '}
                    {model.kind === 'llm' ? 'Clip finder AI' : 'Transcription'}
                  </span>
                </div>
                <button
                  type="button"
                  className="button small"
                  disabled={busy !== null}
                  onClick={() => void add(model.path, model.name)}
                >
                  {busy === model.path ? 'Adding…' : 'Use this'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted spaced">Nothing found</p>
        )
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
