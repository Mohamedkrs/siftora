import { useEffect, useState } from 'react'
import { useSettings } from '../state/settings'

interface AppInfo {
  version: string
  platform: string
  userData: string
}

const languages = ['auto', 'en', 'fr', 'ar', 'es', 'de', 'pt', 'it', 'nl', 'tr', 'ja', 'ko', 'zh']

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
