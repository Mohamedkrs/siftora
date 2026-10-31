import { useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CATALOG, SPEAKER_MODEL_IDS } from '../../../shared/catalog'
import { mediaUrl } from '../../../shared/jobs'
import VideoCard from '../components/VideoCard'
import { formatBytes, formatClock } from '../lib/format'
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

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function folderOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts.slice(0, -1).join(path.includes('\\') ? '\\' : '/')
}

const VAD_ID = 'silero-vad'

const BACKEND_LABELS: Record<string, string> = {
  cuda: 'NVIDIA GPU',
  metal: 'Apple GPU',
  vulkan: 'GPU (Vulkan)',
  cpu: 'CPU'
}

interface VideoInfo {
  durationMs: number
  width: number
  height: number
}

/** A video waiting to be analysed: a frame, its name, length and resolution once known. */
function VideoRow(props: {
  source: string
  info?: VideoInfo
  onInfo: (info: VideoInfo) => void
  onRemove: () => void
}) {
  const youtube = isYouTubeUrl(props.source)
  return (
    <li className="video-row">
      <span className="video-row-thumb">
        {youtube ? (
          <span className="video-row-yt" aria-hidden="true">
            ▶
          </span>
        ) : (
          <video
            src={mediaUrl(props.source)}
            muted
            preload="metadata"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget
              props.onInfo({ durationMs: video.duration * 1000, width: video.videoWidth, height: video.videoHeight })
              video.currentTime = Math.min(30, video.duration * 0.1) // a frame past any intro card
            }}
          />
        )}
      </span>
      <span className="video-row-text">
        <strong title={props.source}>{youtube ? props.source : fileName(props.source)}</strong>
        <span className="muted">
          {youtube
            ? 'YouTube · downloaded when it starts'
            : [
                props.info ? formatClock(props.info.durationMs) : null,
                props.info?.height ? `${props.info.height}p` : null,
                folderOf(props.source)
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </span>
      <button type="button" className="icon-button" aria-label={`Remove ${fileName(props.source)}`} onClick={props.onRemove}>
        ×
      </button>
    </li>
  )
}

export default function Create() {
  const { settings, update } = useSettings()
  const { models, hardware } = useModels()
  const { jobs, add } = useJobs()
  const navigate = useNavigate()
  const [videos, setVideos] = useState<string[]>([])
  const [info, setInfo] = useState<Record<string, VideoInfo>>({})
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [starting, setStarting] = useState(false)

  const speakersInstalled = SPEAKER_MODEL_IDS.every((id) => models[id]?.status === 'installed')
  const vadInstalled = models[VAD_ID]?.status === 'installed'
  const bytesOf = (ids: string[]): number =>
    ids.reduce((sum, id) => sum + (CATALOG.find((model) => model.id === id)?.bytes ?? 0), 0)

  const modelName = (id: string | null): string | null =>
    id ? (CATALOG.find((m) => m.id === id)?.name ?? settings.customModels.find((m) => m.id === id)?.name ?? id) : null
  const backend = settings.engineBackend === 'auto' ? hardware?.backend : settings.engineBackend
  const runsOn = backend ? BACKEND_LABELS[backend] : null
  const transcriber =
    settings.transcriptionProvider === 'openai-whisper'
      ? `OpenAI Whisper (Python)${settings.openaiWhisperModel ? ` · ${settings.openaiWhisperModel}` : ''}`
      : modelName(settings.transcriptionModel)
  const finder =
    settings.llmProvider === 'ollama' ? (settings.ollamaModel ? `Ollama · ${settings.ollamaModel}` : null) : modelName(settings.llmModel)

  const recent = jobs.filter((job) => job.stage === 'done').slice(0, 4)
  const totalMs = videos.reduce((sum, video) => sum + (info[video]?.durationMs ?? 0), 0)
  const youtubeCount = videos.filter(isYouTubeUrl).length

  const addVideos = (paths: string[]): void => {
    const clean = paths.filter((path) => path.trim().length > 0)
    if (clean.length > 0) setVideos((current) => Array.from(new Set([...current, ...clean])))
  }

  const browse = async (): Promise<void> => {
    try {
      addVideos(await window.api.pickVideos())
    } catch (err) {
      window.api.log('error', `pickVideos failed: ${String(err)}`)
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDragging(false)
    addVideos(
      Array.from(event.dataTransfer.files).flatMap((file) => {
        try {
          const path = window.api.getPathForFile(file)
          return path ? [path] : []
        } catch {
          return []
        }
      })
    )
  }

  const addUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = url.trim()
    if (!isYouTubeUrl(value)) {
      setUrlError('Paste a youtube.com or youtu.be link.')
      return
    }
    setUrlError('')
    setUrl('')
    addVideos([value])
  }

  const start = (): void => {
    setStarting(true)
    void add(videos)
      .then(() => {
        setVideos([])
        navigate('/queue')
      })
      .finally(() => setStarting(false))
  }

  return (
    <div className="screen wide">
      <div className="screen-head">
        <h1>Create</h1>
        <p>Add long videos and Siftora finds the moments worth turning into shorts.</p>
      </div>

      <div className="create-layout">
        <div className="create-main">
          <section
            className={dragging ? 'card add-videos dragging' : 'card add-videos'}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
            }}
            onDrop={onDrop}
          >
            <button type="button" className="add-drop" onClick={() => void browse()}>
              <svg className="add-icon" viewBox="0 0 48 48" aria-hidden="true">
                <rect x="6" y="10" width="36" height="28" rx="6" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <path d="M21 19 L29 24 L21 29 Z" fill="currentColor" />
              </svg>
              <strong>{dragging ? 'Drop to add' : 'Drop videos here or click to browse'}</strong>
              <span className="muted">mp4, mov, mkv, webm, avi, m4v · stays on your computer</span>
            </button>
            <div className="add-or" aria-hidden="true">
              <span>or</span>
            </div>
            <form className="url-row" onSubmit={addUrl}>
              <input
                id="youtube-url"
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Paste a YouTube link…"
                aria-label="YouTube link"
              />
              <button type="submit" className="button">
                Add
              </button>
            </form>
            {urlError ? <p className="error">{urlError}</p> : null}
          </section>

          {videos.length > 0 ? (
            <section className="card">
              <div className="section-head">
                <h2>
                  {videos.length} {videos.length === 1 ? 'video' : 'videos'} ready
                </h2>
                <button type="button" className="link-button" onClick={() => setVideos([])}>
                  Clear all
                </button>
              </div>
              <ul className="video-rows">
                {videos.map((video) => (
                  <VideoRow
                    key={video}
                    source={video}
                    info={info[video]}
                    onInfo={(next) => setInfo((current) => ({ ...current, [video]: next }))}
                    onRemove={() => setVideos((current) => current.filter((item) => item !== video))}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <ol className="steps" aria-label="How it works">
              <li>
                <span className="step-dot one" aria-hidden="true" />
                <strong>Add a long video</strong>
                <span className="muted">A podcast, stream, interview or vlog. Files or YouTube links.</span>
              </li>
              <li>
                <span className="step-dot two" aria-hidden="true" />
                <strong>Siftora finds the moments</strong>
                <span className="muted">It transcribes, follows the speakers and picks clips with a hook and a payoff.</span>
              </li>
              <li>
                <span className="step-dot three" aria-hidden="true" />
                <strong>Style and render</strong>
                <span className="muted">Review the clips by score, pick a caption style and render vertical reels.</span>
              </li>
            </ol>
          )}

          {recent.length > 0 ? (
            <section className="recent">
              <div className="section-head">
                <h2>Recent</h2>
                <Link to="/results">All results</Link>
              </div>
              <nav className="video-strip" aria-label="Recent videos">
                {recent.map((job) => (
                  <VideoCard key={job.id} job={job} selected={false} onSelect={() => navigate(`/results?job=${job.id}`)} />
                ))}
              </nav>
            </section>
          ) : null}
        </div>

        <aside className="create-side-panels">
          <section className="card side-panel">
            <h2>How Siftora will work</h2>
            <dl className="plan">
              <div>
                <dt>Transcribe</dt>
                <dd className={transcriber ? undefined : 'model-warning'}>
                  {transcriber ?? 'No model chosen'}
                  {transcriber && runsOn && settings.transcriptionProvider !== 'openai-whisper' ? <span className="muted"> · {runsOn}</span> : null}
                </dd>
              </div>
              <div>
                <dt>Find moments</dt>
                <dd className={finder ? undefined : 'model-warning'}>
                  {finder ?? 'No model chosen'}
                  {finder && runsOn && settings.llmProvider !== 'ollama' ? <span className="muted"> · {runsOn}</span> : null}
                </dd>
              </div>
              <div>
                <dt>Speakers</dt>
                <dd>{settings.detectSpeakers && speakersInstalled ? 'Detected, for per-speaker colors' : 'Off'}</dd>
              </div>
            </dl>
            <Link to="/models" className="side-link">
              Change models →
            </Link>
          </section>

          <section className="card side-panel">
            <h2>Clips</h2>
            <div className="clip-length">
              <label className="field">
                Shortest (s)
                <input
                  id="min-clip"
                  type="number"
                  min={5}
                  max={settings.maxClipSeconds}
                  value={settings.minClipSeconds}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) update({ minClipSeconds: value })
                  }}
                />
              </label>
              <label className="field">
                Longest (s)
                <input
                  id="max-clip"
                  type="number"
                  min={settings.minClipSeconds}
                  max={600}
                  value={settings.maxClipSeconds}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) update({ maxClipSeconds: value })
                  }}
                />
              </label>
            </div>
            <label className="field">
              Keep clips scoring at least {Math.round(settings.minScore * 10)}
              <input
                id="min-score"
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={settings.minScore}
                onChange={(event) => update({ minScore: Number(event.target.value) })}
              />
            </label>

            <div className="toggles">
              <label className={vadInstalled ? 'toggle' : 'toggle disabled'}>
                <input
                  type="checkbox"
                  disabled={!vadInstalled}
                  checked={settings.useVad && vadInstalled}
                  onChange={(event) => update({ useVad: event.target.checked })}
                />
                <span>
                  <strong>Voice detection</strong>
                  <span className="muted">
                    {vadInstalled ? (
                      'Skips silence and music, so no invented captions.'
                    ) : (
                      <>
                        Not downloaded ({formatBytes(bytesOf([VAD_ID]))}). Get it in <Link to="/models">Models</Link>.
                      </>
                    )}
                  </span>
                </span>
              </label>
              <label className={speakersInstalled ? 'toggle' : 'toggle disabled'}>
                <input
                  type="checkbox"
                  disabled={!speakersInstalled}
                  checked={settings.detectSpeakers && speakersInstalled}
                  onChange={(event) => update({ detectSpeakers: event.target.checked })}
                />
                <span>
                  <strong>Speaker detection</strong>
                  <span className="muted">
                    {speakersInstalled ? (
                      'Lets each speaker get their own caption color.'
                    ) : (
                      <>
                        Not downloaded ({formatBytes(bytesOf(SPEAKER_MODEL_IDS))}). Get it in <Link to="/models">Models</Link>.
                      </>
                    )}
                  </span>
                </span>
              </label>
            </div>
            <p className="muted small">Each video keeps the settings it was added with.</p>
          </section>
        </aside>
      </div>

      <div className="start-bar">
        <span className="muted">
          {videos.length === 0
            ? 'Add a video to start.'
            : [
                `${videos.length} ${videos.length === 1 ? 'video' : 'videos'}`,
                totalMs > 0 ? `${formatClock(totalMs)} of video` : null,
                youtubeCount > 0 ? `${youtubeCount} from YouTube` : null
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
        <button type="button" className="button primary large" disabled={videos.length === 0 || starting} onClick={start}>
          {videos.length > 1 ? `Find clips in ${videos.length} videos` : 'Find clips'} →
        </button>
      </div>
    </div>
  )
}
