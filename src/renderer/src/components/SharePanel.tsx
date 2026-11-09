import { useState } from 'react'
import type { Clip } from '../../../shared/jobs'
import { SHARE_PLATFORMS, shareText } from '../../../shared/share'

export default function SharePanel(props: { clip: Clip; reelPath?: string }) {
  const [copied, setCopied] = useState('')

  const copy = (key: string, value: string): void => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(key)
        window.setTimeout(() => setCopied((current) => (current === key ? '' : current)), 1500)
      },
      (error: unknown) => window.api.log('warn', `Could not copy ${key}: ${String(error)}`)
    )
  }

  return (
    <div className="share-panel">
      {props.reelPath ? null : <p className="muted">Render the reel first, then upload the file.</p>}
      {SHARE_PLATFORMS.map((platform) => {
        const { title, text } = shareText(props.clip, platform.id)
        const titleKey = `${platform.id}-title`
        const textKey = `${platform.id}-text`
        return (
          <section key={platform.id} className="share-platform">
            <h4>{platform.name}</h4>
            {title ? (
              <div className="share-row">
                <span>Title</span>
                <input className="share-title" readOnly value={title} aria-label={`${platform.name} title`} />
                <button type="button" className="button small" onClick={() => copy(titleKey, title)}>
                  {copied === titleKey ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : null}
            <textarea className="share-text" rows={4} readOnly value={text} aria-label={`${platform.name} caption`} />
            <div className="share-row">
              <button type="button" className="button small" onClick={() => copy(textKey, text)}>
                {copied === textKey ? 'Copied' : 'Copy'}
              </button>
              <button type="button" className="button small" onClick={() => void window.api.openUploadPage(platform.id)}>
                Open upload page
              </button>
              {props.reelPath ? (
                <button type="button" className="button small" onClick={() => void window.api.showInFolder(props.reelPath as string)}>
                  Show file
                </button>
              ) : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}
