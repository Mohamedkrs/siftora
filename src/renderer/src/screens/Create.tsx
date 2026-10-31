import { useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CATALOG, SPEAKER_MODEL_IDS } from '../../../shared/catalog'
import { formatBytes } from '../lib/format'
import { useJobs } from '../state/jobs'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'

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

const VAD_ID = 'silero-vad'

export default function Create() {
  const { settings, update } = useSettings()
  const { models } = useModels()
  const [videos, setVideos] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const { add } = useJobs()
  const navigate = useNavigate()
  const speakersInstalled = SPEAKER_MODEL_IDS.every((id) => models[id]?.status === 'installed')
  const vadInstalled = models[VAD_ID]?.status === 'installed'

  /** Hint shown under a detection option whose models are not downloaded yet. */
  const notDownloaded = (bytes: number) => (
    <span className="model-warning">
      Not downloaded yet ({formatBytes(bytes)}) — download it in <Link to="/models">Models</Link>.
    </span>
  )
  const bytesOf = (ids: string[]): number =>
    ids.reduce((sum, id) => sum + (CATALOG.find((model) => model.id === id)?.bytes ?? 0), 0)

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

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Create</h1>
        <p>Add videos and choose how they are analysed. Pick the caption style later on Results, with a real frame to preview.</p>
      </div>

      <div className="create-main narrow">
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
            </div>
          </section>

          <section className="card">
            <h2>Detection</h2>
            <div className="choice-list">
              <label className={settings.useVad && vadInstalled ? 'choice selected' : vadInstalled ? 'choice' : 'choice disabled'}>
                <input
                  type="checkbox"
                  disabled={!vadInstalled}
                  checked={settings.useVad && vadInstalled}
                  onChange={(event) => update({ useVad: event.target.checked })}
                />
                <span className="choice-text">
                  <strong>Voice detection</strong>
                  <span>Skips silence and music so Whisper does not invent captions. Recommended.</span>
                  {vadInstalled ? null : notDownloaded(bytesOf([VAD_ID]))}
                </span>
              </label>
              <label
                className={settings.detectSpeakers && speakersInstalled ? 'choice selected' : speakersInstalled ? 'choice' : 'choice disabled'}
              >
                <input
                  type="checkbox"
                  disabled={!speakersInstalled}
                  checked={settings.detectSpeakers && speakersInstalled}
                  onChange={(event) => update({ detectSpeakers: event.target.checked })}
                />
                <span className="choice-text">
                  <strong>Speaker detection</strong>
                  <span>Works out who is speaking, so each speaker's captions can get their own color.</span>
                  {speakersInstalled ? null : notDownloaded(bytesOf(SPEAKER_MODEL_IDS))}
                </span>
              </label>
            </div>
            <p className="muted">Each video keeps the detection options it was added with.</p>
          </section>

          <div className="actions">
            <button
              type="button"
              className="button primary"
              disabled={videos.length === 0}
              onClick={() => {
                void add(videos).then(() => {
                  setVideos([])
                  navigate('/queue')
                })
              }}
            >
              Find clips
            </button>
            {videos.length === 0 ? (
              <span className="muted">Add at least one video to continue.</span>
            ) : null}
          </div>
      </div>
    </div>
  )
}
