import { useState } from 'react'
import { COOKIES_BROWSERS, type CookiesSource } from '../../../shared/types'
import { useSettings } from '../state/settings'

const capital = (text: string): string => `${text[0].toUpperCase()}${text.slice(1)}`

/**
 * Where the downloader gets a sign-in for age-restricted or members-only videos: a browser,
 * or a cookies.txt file (copied into the app). `onChosen` runs once a source is set.
 */
export default function SignInPicker(props: { noneLabel: string; onChosen?: () => void }) {
  const { settings, update } = useSettings()
  const [error, setError] = useState('')

  const choose = async (value: string): Promise<void> => {
    setError('')
    if (value === 'file') {
      const result = await window.api.importCookiesFile()
      if (result.error) setError(result.error)
      if (!result.imported) return
    }
    update({ cookiesBrowser: (value || null) as CookiesSource | null })
    if (value) props.onChosen?.()
  }

  return (
    <>
      <select
        aria-label="Where to get your sign-in from"
        value={settings.cookiesBrowser ?? ''}
        onChange={(event) => void choose(event.target.value)}
      >
        <option value="">{props.noneLabel}</option>
        {COOKIES_BROWSERS.map((browser) => (
          <option key={browser} value={browser}>
            {capital(browser)}
          </option>
        ))}
        <option value="file">cookies.txt file…</option>
      </select>
      {settings.cookiesBrowser === 'file' ? (
        <button type="button" className="button small" onClick={() => void choose('file')}>
          Load a newer file…
        </button>
      ) : null}
      {error ? <span className="error">{error}</span> : null}
    </>
  )
}
