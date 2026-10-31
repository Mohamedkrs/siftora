import { useState, type DragEvent, type FormEvent } from 'react'
import NotImplemented from '../components/NotImplemented'
import { useSettings } from '../state/settings'
import { CAPTION_FONTS, type Layout, type SubtitleStyle } from '../../../shared/types'

// Checkbox and color picker are siblings, not inside one <label>: a label forwards
// every click to its first control, which made the picker impossible to open.
function ToggleColor(props: {
  label: string
  checked: boolean
  color: string
  onToggle: (checked: boolean) => void
  onColor: (color: string) => void
}) {
  return (
    <div className="field">
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(event) => props.onToggle(event.target.checked)}
        />{' '}
        {props.label}
      </label>
      <input
        type="color"
        aria-label={`${props.label} color`}
        disabled={!props.checked}
        value={props.color}
        onChange={(event) => props.onColor(event.target.value)}
      />
    </div>
  )
}

const PREVIEW_HEIGHT = 420

const layoutOptions: Array<{ value: Layout; title: string; description: string }> = [
  { value: 'blurred', title: 'Blurred background', description: 'Full frame, blurred sides' },
  { value: 'focused', title: 'Focused (crop)', description: 'Fill the 9:16 frame' }
]

function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return (
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be'
    )
  } catch {
    return false
  }
}

function displayName(value: string): string {
  if (/^https?:\/\//i.test(value)) return value
  return value.split(/[\\/]/).pop() ?? value
}

export default function Create() {
  const { settings, update } = useSettings()
  const [videos, setVideos] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [findClicked, setFindClicked] = useState(false)
  const [previewSpeaker, setPreviewSpeaker] = useState(0)

  const subtitle = settings.subtitle

  const addVideos = (paths: string[]): void => {
    const clean = paths.filter((path) => path.trim().length > 0)
    if (clean.length === 0) return
    setVideos((current) => Array.from(new Set([...current, ...clean])))
  }

  const browse = async (): Promise<void> => {
    try {
      addVideos(await window.api.pickVideos())
    } catch (err) {
      window.api.log('error', `pickVideos failed: ${String(err)}`)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)

    const paths = Array.from(event.dataTransfer.files).flatMap((file) => {
      try {
        const path = window.api.getPathForFile(file)
        return path ? [path] : []
      } catch {
        return []
      }
    })

    addVideos(paths)
  }

  const addUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = url.trim()

    if (!isYouTubeUrl(value)) {
      setUrlError('Enter a valid youtube.com or youtu.be URL.')
      return
    }

    setUrlError('')
    setUrl('')
    addVideos([value])
  }

  const setSubtitle = (patch: Partial<SubtitleStyle>): void => {
    update({ subtitle: { ...subtitle, ...patch } })
  }

  const caption = subtitle.uppercase
    ? 'THIS IS HOW YOUR CAPTIONS LOOK'
    : 'This is how your captions look'
  const words = caption.split(' ')
  const captionSize =
    Math.round((subtitle.sizePx * PREVIEW_HEIGHT * 10) / 1920) / 10
  // Stroke is painted under the fill (paint-order), so only the outer half shows; double it.
  const outlineSize = Math.max(1, Math.round(captionSize * 0.16 * 10) / 10)
  const fontWeight = CAPTION_FONTS.find((f) => f.family === subtitle.font)?.weight ?? 800
  const captionAlign =
    subtitle.position === 'top'
      ? 'flex-start'
      : subtitle.position === 'bottom'
        ? 'flex-end'
        : 'center'

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Create</h1>
        <p>Add videos, choose a layout, and style your captions.</p>
      </div>

      <div className="create-grid">
        <div className="create-main">
          <section className="card">
            <div
              className={dragging ? 'drop-zone dragging' : 'drop-zone'}
              role="button"
              tabIndex={0}
              onClick={() => void browse()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void browse()
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <strong>Drop videos here or click to browse</strong>
              <span>mp4, mov, mkv, webm, avi, m4v</span>
            </div>

            {videos.length > 0 ? (
              <ul className="file-list">
                {videos.map((video) => (
                  <li className="file-item" key={video}>
                    <span className="file-name" title={video}>
                      {displayName(video)}
                      {isYouTubeUrl(video) ? <span className="tag">YouTube</span> : null}
                    </span>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() =>
                        setVideos((current) => current.filter((item) => item !== video))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No videos selected yet.</p>
            )}
          </section>

          <section className="card">
            <h2>YouTube</h2>
            <form className="url-row" onSubmit={addUrl}>
              <input
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                aria-label="YouTube URL"
              />
              <button type="submit" className="button">
                Add
              </button>
            </form>
            {urlError ? <p className="error">{urlError}</p> : null}
            <div className="spaced">
              <NotImplemented phase={5} note="downloading" />
            </div>
          </section>

          <section className="card">
            <h2>Layout</h2>
            <div className="layout-grid">
              {layoutOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    settings.layout === option.value ? 'layout-card selected' : 'layout-card'
                  }
                  aria-pressed={settings.layout === option.value}
                  onClick={() => update({ layout: option.value })}
                >
                  <span className={`mock-frame ${option.value}`} aria-hidden="true">
                    {option.value === 'blurred' ? (
                      <>
                        <span className="mock-bg" />
                        <span className="mock-inner" />
                      </>
                    ) : (
                      <span className="mock-fill" />
                    )}
                  </span>
                  <span className="layout-text">
                    <strong>{option.title}</strong>
                    <span>{option.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Subtitle style</h2>
            <div className="field-grid">
              <label className="field">
                Font
                <select
                  value={subtitle.font}
                  onChange={(event) => setSubtitle({ font: event.target.value })}
                >
                  {CAPTION_FONTS.map((f) => (
                    <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                      {f.family}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                Size — {subtitle.sizePx}px
                <input
                  type="range"
                  min={32}
                  max={120}
                  value={subtitle.sizePx}
                  onChange={(event) => setSubtitle({ sizePx: Number(event.target.value) })}
                />
              </label>

              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={subtitle.speakerColors}
                    onChange={(event) => setSubtitle({ speakerColors: event.target.checked })}
                  />{' '}
                  {subtitle.speakerColors ? 'Color per speaker' : 'Text color (or color per speaker)'}
                </label>
                {subtitle.speakerColors ? (
                  <div className="speaker-swatches">
                    {subtitle.speakerPalette.map((c, i) => (
                      <input
                        key={i}
                        type="color"
                        title={`Speaker ${i + 1}`}
                        aria-label={`Speaker ${i + 1} color`}
                        value={c}
                        onFocus={() => setPreviewSpeaker(i)}
                        onChange={(event) => {
                          setPreviewSpeaker(i)
                          setSubtitle({
                            speakerPalette: subtitle.speakerPalette.map((old, j) =>
                              j === i ? event.target.value : old
                            )
                          })
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <input
                    type="color"
                    aria-label="Text color"
                    value={subtitle.color}
                    onChange={(event) => setSubtitle({ color: event.target.value })}
                  />
                )}
              </div>

              <ToggleColor
                label="Highlight active word"
                checked={subtitle.highlight}
                color={subtitle.highlightColor}
                onToggle={(highlight) => setSubtitle({ highlight })}
                onColor={(highlightColor) => setSubtitle({ highlightColor })}
              />

              <ToggleColor
                label="Outline"
                checked={subtitle.outline}
                color={subtitle.outlineColor}
                onToggle={(outline) => setSubtitle({ outline })}
                onColor={(outlineColor) => setSubtitle({ outlineColor })}
              />

              <label className="field">
                Position
                <select
                  value={subtitle.position}
                  onChange={(event) =>
                    setSubtitle({ position: event.target.value as SubtitleStyle['position'] })
                  }
                >
                  <option value="bottom">Bottom</option>
                  <option value="middle">Middle</option>
                  <option value="top">Top</option>
                </select>
              </label>

              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={subtitle.uppercase}
                  onChange={(event) => setSubtitle({ uppercase: event.target.checked })}
                />
                Uppercase
              </label>
            </div>
          </section>

          <div className="actions">
            <button
              type="button"
              className="button primary"
              disabled={videos.length === 0}
              onClick={() => setFindClicked(true)}
            >
              Find clips
            </button>
            {videos.length === 0 ? (
              <span className="muted">Add at least one video to continue.</span>
            ) : null}
          </div>

          {findClicked ? <NotImplemented phase={3} note="clip detection" /> : null}
        </div>

        <aside className="create-side">
          <section className="card">
            <h2>Live preview</h2>
            <div className="preview-wrap">
              <div className={`preview-frame ${settings.layout}`}>
                <div className="preview-backdrop" />
                <div className="preview-content" />
                <div className="preview-caption" style={{ alignItems: captionAlign }}>
                  <div
                    className="caption-text"
                    style={{
                      fontFamily: `"${subtitle.font}", "Arial Black", Arial, sans-serif`,
                      fontWeight,
                      fontSize: captionSize,
                      color: subtitle.speakerColors
                        ? subtitle.speakerPalette[previewSpeaker]
                        : subtitle.color,
                      WebkitTextStroke: subtitle.outline
                        ? `${outlineSize}px ${subtitle.outlineColor}`
                        : undefined,
                      paintOrder: 'stroke fill',
                      textShadow: '0 2px 8px rgba(0, 0, 0, 0.45)'
                    }}
                  >
                    {words.map((word, index) => (
                      <span
                        key={`${word}-${index}`}
                        style={
                          subtitle.highlight && index === 1
                            ? { color: subtitle.highlightColor }
                            : undefined
                        }
                      >
                        {word}
                        {index < words.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
