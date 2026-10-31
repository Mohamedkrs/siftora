import { useEffect, useState } from 'react'
import type { StorageUsage } from '../../../shared/types'
import { formatBytes } from '../lib/format'
import { useSettings } from '../state/settings'

interface AppInfo {
  version: string
  platform: string
  userData: string
}

const languages = ['auto', 'en', 'fr', 'ar', 'es', 'de', 'pt', 'it', 'nl', 'tr', 'ja', 'ko', 'zh']

/** What the app's data folder holds, and ways to free the space or remove it before deleting the app. */
function StorageSection() {
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)

  const load = (): void => {
    window.api
      .getStorage()
      .then(setUsage)
      .catch((err: unknown) => window.api.log('error', `getStorage failed: ${String(err)}`))
  }
  useEffect(load, [])

  const parts = usage
    ? [
        { label: 'Engines', bytes: usage.engines, tone: 'violet' },
        { label: 'AI models', bytes: usage.models, tone: 'magenta' },
        { label: 'Results and transcripts', bytes: usage.results, tone: 'pink' },
        { label: 'Settings and cache', bytes: usage.other, tone: 'orange' }
      ]
    : []
  const downloads = usage ? usage.engines + usage.models : 0

  const deleteDownloads = async (): Promise<void> => {
    if (!confirm(`Delete the downloaded engines and AI models (${formatBytes(downloads)})?\n\nYour settings and results stay. You can download them again from Models.`)) return
    setBusy(true)
    const outcome = await window.api.deleteDownloads()
    setBusy(false)
    setNote(outcome.ok ? { text: `Freed ${formatBytes(outcome.freed ?? 0)}.` } : { text: outcome.problem ?? 'Could not delete.', error: true })
    load()
  }

  const removeAll = async (): Promise<void> => {
    if (!usage) return
    if (!confirm(`Remove all Siftora data (${formatBytes(usage.total)})?\n\nThis deletes the engines, AI models, settings, results and transcripts, then closes Siftora. Use it before deleting the app. Your rendered reels in the Videos folder are not touched.`)) return
    setBusy(true)
    const outcome = await window.api.removeAllData()
    setBusy(false)
    if (!outcome.ok) setNote({ text: outcome.problem ?? 'Could not remove the data.', error: true })
  }

  return (
    <section className="card storage">
      <div className="section-head">
        <h2>Storage</h2>
        <span className="storage-total">{usage ? formatBytes(usage.total) : 'Measuring…'}</span>
      </div>
      {usage && usage.total > 0 ? (
        <>
          <div className="storage-bar" aria-hidden="true">
            {parts.map((part) => (
              <span key={part.label} className={`tone-${part.tone}`} style={{ flexGrow: part.bytes }} />
            ))}
          </div>
          <dl className="storage-parts">
            {parts.map((part) => (
              <div key={part.label}>
                <dt>
                  <span className={`storage-dot tone-${part.tone}`} />
                  {part.label}
                </dt>
                <dd>{formatBytes(part.bytes)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <p className="muted small">
        Models used from Ollama or elsewhere stay where they are and are not counted here. Rendered reels are in your
        Videos folder.
      </p>
      <div className="actions">
        <button type="button" className="button" onClick={() => void window.api.openDataFolder()}>
          Open folder
        </button>
        <button type="button" className="button" disabled={busy || downloads === 0} onClick={() => void deleteDownloads()}>
          Delete engines and models{downloads > 0 ? ` (${formatBytes(downloads)})` : ''}
        </button>
        <button type="button" className="button danger" disabled={busy || !usage} onClick={() => void removeAll()}>
          Remove all Siftora data
        </button>
      </div>
      {note ? <p className={note.error ? 'error' : 'muted small'}>{note.text}</p> : null}
    </section>
  )
}

export default function SettingsScreen() {
  const { settings, update } = useSettings()
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let alive = true

    window.api
      .appInfo()
      .then((loaded) => {
        if (alive) setInfo(loaded)
      })
      .catch((err: unknown) => {
        window.api.log('error', `appInfo failed: ${String(err)}`)
      })

    return () => {
      alive = false
    }
  }, [])

  const chooseOutputDir = async (): Promise<void> => {
    try {
      const dir = await window.api.pickOutputDir()
      if (dir) update({ outputDir: dir })
    } catch (err) {
      window.api.log('error', `pickOutputDir failed: ${String(err)}`)
    }
  }

  const updateNumber = (
    key: 'minClipSeconds' | 'maxClipSeconds' | 'minScore',
    value: string
  ): void => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return

    if (key === 'minClipSeconds') update({ minClipSeconds: parsed })
    else if (key === 'maxClipSeconds') update({ maxClipSeconds: parsed })
    else update({ minScore: parsed })
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Settings</h1>
        <p>Defaults applied to every new clip. Changes save immediately.</p>
      </div>

      <section className="card">
        <h2>Output</h2>
        <div className="row">
          <div>
            <div className="label">Output folder</div>
            <div className="value">{settings.outputDir || 'Videos folder (default)'}</div>
          </div>
          <button type="button" className="button" onClick={() => void chooseOutputDir()}>
            Choose…
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Clips</h2>
        <div className="field-grid">
          <label className="field">
            Minimum length (seconds)
            <input
              type="number"
              min={1}
              max={3600}
              value={settings.minClipSeconds}
              onChange={(event) => updateNumber('minClipSeconds', event.target.value)}
            />
          </label>

          <label className="field">
            Maximum length (seconds)
            <input
              type="number"
              min={1}
              max={3600}
              value={settings.maxClipSeconds}
              onChange={(event) => updateNumber('maxClipSeconds', event.target.value)}
            />
          </label>

          <label className="field">
            Minimum score — {settings.minScore.toFixed(1)}
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={settings.minScore}
              onChange={(event) => updateNumber('minScore', event.target.value)}
            />
          </label>

          <label className="field">
            Language
            <select
              value={settings.language}
              onChange={(event) => update({ language: event.target.value })}
            >
              {languages.map((language) => (
                <option key={language} value={language}>
                  {language === 'auto' ? 'Auto detect' : language}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <StorageSection />

      <section className="card">
        <h2>Setup</h2>
        <div className="row">
          <div>
            <div className="label">First-start setup</div>
            <div className="value">Check your hardware again and choose the engines and models step by step.</div>
          </div>
          <button type="button" className="button" onClick={() => update({ onboarded: false })}>
            Run setup again
          </button>
        </div>
        <p className="muted small">Your videos, results and downloaded models are kept.</p>
      </section>

      <section className="card">
        <h2>About</h2>
        {info ? (
          <dl className="about">
            <dt>Version</dt>
            <dd>{info.version}</dd>
            <dt>Platform</dt>
            <dd>{info.platform}</dd>
            <dt>User data</dt>
            <dd>{info.userData}</dd>
          </dl>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </section>
    </div>
  )
}
