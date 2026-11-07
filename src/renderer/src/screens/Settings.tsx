import { useEffect, useState } from 'react'
import { PALETTES, type StorageUsage, type Theme } from '../../../shared/types'
import kofiButton from '../../../../resources/brand/support-kofi.svg'
import NumberField from '../components/NumberField'
import SignInPicker from '../components/SignInPicker'
import { useDialog } from '../components/Dialog'
import { formatBytes } from '../lib/format'
import { useSettings } from '../state/settings'

const THEMES: [Theme, string][] = [
  ['system', 'Match system'],
  ['dark', 'Dark'],
  ['light', 'Light']
]

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
  const dialog = useDialog()

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
    const ok = await dialog.confirm({
      title: 'Delete the downloaded engines and AI models?',
      message: `Frees ${formatBytes(downloads)}. Your settings and results stay, and you can download them again from Models.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    setBusy(true)
    const outcome = await window.api.deleteDownloads()
    setBusy(false)
    setNote(outcome.ok ? { text: `Freed ${formatBytes(outcome.freed ?? 0)}.` } : { text: outcome.problem ?? 'Could not delete.', error: true })
    load()
  }

  const removeAll = async (): Promise<void> => {
    if (!usage) return
    const ok = await dialog.confirm({
      title: 'Remove all Siftora data?',
      message: `This deletes ${formatBytes(usage.total)}: the engines, AI models, settings, results and transcripts, then closes Siftora. Use it before deleting the app.\n\nYour rendered reels in the Videos folder are not touched.`,
      confirmLabel: 'Remove everything',
      danger: true
    })
    if (!ok) return
    setBusy(true)
    const outcome = await window.api.removeAllData()
    setBusy(false)
    if (!outcome.ok || !outcome.removed) {
      setNote({ text: outcome.problem ?? 'Could not remove the data.', error: true })
      return
    }
    const removed = outcome.removed
    await dialog.notice({
      title: `Removed ${formatBytes(removed.total)} of Siftora data`,
      message: `Engines ${formatBytes(removed.engines)}, AI models ${formatBytes(removed.models)}, results and transcripts ${formatBytes(removed.results)}, settings and cache ${formatBytes(removed.other)}.\n\nSiftora will now close. Your rendered reels were not touched. You can delete the app itself now.`,
      confirmLabel: 'Close Siftora'
    })
    void window.api.quitAfterRemoval()
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
  const [newer, setNewer] = useState<{ version: string; url: string } | null>(null)

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
    if (settings.checkUpdates) {
      void window.api.checkForUpdate().then((found) => {
        if (alive) setNewer(found)
      })
    } else setNewer(null)

    return () => {
      alive = false
    }
  }, [settings.checkUpdates])

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
        <h2>Appearance</h2>
        <div className="model-chips" role="radiogroup" aria-label="Theme">
          <span className="chips-label">Theme</span>
          {THEMES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={settings.theme === value}
              className={settings.theme === value ? 'chip selected' : 'chip'}
              onClick={() => update({ theme: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="model-chips" role="radiogroup" aria-label="Color">
          <span className="chips-label">Color</span>
          {PALETTES.map((palette) => (
            <button
              key={palette.id}
              type="button"
              role="radio"
              aria-checked={settings.palette === palette.id}
              className={settings.palette === palette.id ? 'chip selected' : 'chip'}
              onClick={() => update({ palette: palette.id })}
            >
              <span className="swatch-dot" style={{ background: palette.swatch }} aria-hidden="true" /> {palette.name}
            </button>
          ))}
        </div>
      </section>

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
          <NumberField
            label="Minimum length (seconds)"
            value={settings.minClipSeconds}
            min={1}
            max={settings.maxClipSeconds}
            tooBig={`Can't be longer than the maximum (${settings.maxClipSeconds} s).`}
            onCommit={(minClipSeconds) => update({ minClipSeconds })}
          />

          <NumberField
            label="Maximum length (seconds)"
            value={settings.maxClipSeconds}
            min={settings.minClipSeconds}
            max={3600}
            tooSmall={`Can't be shorter than the minimum (${settings.minClipSeconds} s).`}
            tooBig="At most 3600 (an hour)."
            onCommit={(maxClipSeconds) => update({ maxClipSeconds })}
          />

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

      <section className="card">
        <h2>Video links</h2>
        <label className="field">
          Use my sign-in from
          <span className="signin-actions">
            <SignInPicker noneLabel="Nothing (signed out)" />
          </span>
        </label>
        <p className="muted">
          Needed for age-restricted or members-only videos. Firefox works best; Chrome, Edge and Brave must be
          fully quit first and may still refuse. Otherwise export a cookies.txt on youtube.com with an extension
          such as “Get cookies.txt LOCALLY”. Export it from a private window you sign in to and close right after:
          YouTube replaces the sign-in of open tabs, which breaks the file within days.
        </p>
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
        {settings.gettingStartedHidden ? (
          <div className="row">
            <div>
              <div className="label">Getting started</div>
              <div className="value">The checklist of first steps at the top of Create.</div>
            </div>
            <button type="button" className="button" onClick={() => update({ gettingStartedHidden: false })}>
              Show again
            </button>
          </div>
        ) : null}
        <p className="muted small">Your videos, results and downloaded models are kept.</p>
      </section>

      <section className="card">
        <h2>About</h2>
        {info ? (
          <dl className="about">
            <dt>Version</dt>
            <dd>
              {info.version}
              {newer ? (
                <>
                  {' · '}
                  <a href={newer.url} target="_blank" rel="noreferrer">
                    Siftora {newer.version} is available
                  </a>
                </>
              ) : null}
            </dd>
            <dt>Platform</dt>
            <dd>{info.platform}</dd>
            <dt>User data</dt>
            <dd>{info.userData}</dd>
          </dl>
        ) : (
          <p className="muted">Loading…</p>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.checkUpdates}
            onChange={(event) => update({ checkUpdates: event.target.checked })}
          />
          <span>
            <strong>Check for updates</strong>
            <span className="muted">
              Once per start, Siftora asks GitHub for the newest version. Nothing about you or your videos is sent.
            </span>
          </span>
        </label>
        <p className="muted kofi-note">Siftora is free, with no ads or accounts. If it saves you time, you can support it.</p>
        <a className="kofi-button" href="https://ko-fi.com/mohamedkrs" target="_blank" rel="noreferrer">
          <img src={kofiButton} alt="Buy me a coffee on Ko-fi" height={48} />
        </a>
      </section>
    </div>
  )
}
