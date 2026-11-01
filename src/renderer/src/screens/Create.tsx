import { useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CATALOG, REACTION_MODEL_IDS, llamaTooOld, SPEAKER_MODEL_IDS } from '../../../shared/catalog'
import { DEFAULT_YOUTUBE_HEIGHT, mediaUrl } from '../../../shared/jobs'
import type { YoutubeChoice, YoutubeInfo } from '../../../shared/types'
import VideoCard from '../components/VideoCard'
import { formatBytes, formatClock } from '../lib/format'
import { useJobs } from '../state/jobs'
import { useModels } from '../state/models'
import { useOwnLlamaBuild, useSettings } from '../state/settings'

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

/** Starting choice for a link: its best quality up to DEFAULT_YOUTUBE_HEIGHT. */
function defaultHeight(heights: number[]): number | undefined {
  return heights.find((h) => h <= DEFAULT_YOUTUBE_HEIGHT) ?? heights.at(-1)
}

/** A video waiting to be analysed: a frame, its name, length and resolution once known. */
function VideoRow(props: {
  source: string
  info?: VideoInfo
  /** YouTube links only: undefined while checking, a string when it failed. */
  youtube?: YoutubeInfo | string
  /** Quality picked on this row; else defaultHeight(). */
  quality?: number
  onQuality: (height: number) => void
  onInfo: (info: VideoInfo) => void
  onRemove: () => void
}) {
  const youtube = isYouTubeUrl(props.source)
  const yt = typeof props.youtube === 'object' ? props.youtube : null
  const atHeight = yt ? (props.quality ?? defaultHeight(yt.heights)) : undefined
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
        <strong title={props.source}>{yt ? yt.title : youtube ? props.source : fileName(props.source)}</strong>
        <span className={typeof props.youtube === 'string' ? 'muted video-row-error' : 'muted'}>
          {youtube
            ? typeof props.youtube === 'string'
              ? `YouTube · could not check the link (${props.youtube})`
              : yt
                ? [
                    'YouTube',
                    yt.durationMs ? formatClock(yt.durationMs) : null,
                    yt.heights.length ? `up to ${yt.heights[0]}p` : null
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'YouTube · checking the link…'
            : [
                props.info ? formatClock(props.info.durationMs) : null,
                props.info?.height ? `${props.info.height}p` : null,
                folderOf(props.source)
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </span>
      {yt && atHeight ? (
        <select
          className="video-row-quality"
          aria-label={`Download quality for ${yt.title}`}
          value={atHeight}
          onChange={(event) => props.onQuality(Number(event.target.value))}
        >
          {yt.heights.map((height) => (
            <option key={height} value={height}>
              {height}p
            </option>
          ))}
        </select>
      ) : null}
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
  const [youtube, setYoutube] = useState<Record<string, YoutubeInfo | string>>({})
  const [quality, setQuality] = useState<Record<string, number>>({})
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [starting, setStarting] = useState(false)

  const speakersInstalled = SPEAKER_MODEL_IDS.every((id) => models[id]?.status === 'installed')
  const reactionsInstalled = REACTION_MODEL_IDS.every((id) => models[id]?.status === 'installed')
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
  const llamaBuild = useOwnLlamaBuild()
  const finderProblem =
    settings.llmProvider === 'ollama'
      ? null
      : llamaTooOld(CATALOG.find((m) => m.id === settings.llmModel)?.gguf?.architecture, llamaBuild)
  const finder =
    settings.llmProvider === 'ollama' ? (settings.ollamaModel ? `Ollama · ${settings.ollamaModel}` : null) : modelName(settings.llmModel)

  const recent = jobs.filter((job) => job.stage === 'done').slice(0, 4)
  const totalMs = videos.reduce((sum, video) => {
    const yt = youtube[video]
    return sum + (info[video]?.durationMs ?? (typeof yt === 'object' ? yt.durationMs : 0))
  }, 0)
  const youtubeCount = videos.filter(isYouTubeUrl).length
  const checking = videos.some((video) => isYouTubeUrl(video) && youtube[video] === undefined)

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
    if (youtube[value] === undefined) {
      window.api
        .youtubeInfo(value)
        .then((result) => setYoutube((current) => ({ ...current, [value]: result })))
        .catch((err: unknown) => {
          window.api.log('warn', `youtubeInfo failed: ${String(err)}`)
          // Keep only yt-dlp's own words, e.g. "Private video" or "Video unavailable".
          const reason = (err instanceof Error ? err.message : String(err))
            .replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
            .replace(/^.*?exited with code \d+: /, '')
            .replace(/^.*ERROR: (\[[^\]]+\] [^:]+: )?/, '')
          setYoutube((current) => ({ ...current, [value]: reason || 'unknown error' }))
        })
    }
  }

  const start = (): void => {
    setStarting(true)
    // Send the shown default too, so every checked link downloads at what its row says.
    const links: Record<string, YoutubeChoice> = {}
    for (const video of videos) {
      const yt = youtube[video]
      const height = typeof yt === 'object' ? (quality[video] ?? defaultHeight(yt.heights)) : undefined
      if (typeof yt === 'object' && height !== undefined) links[video] = { height, title: yt.title }
    }
    void add(videos, links)
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
                    youtube={youtube[video]}
                    quality={quality[video]}
                    onQuality={(height) => setQuality((current) => ({ ...current, [video]: height }))}
                    onInfo={(next) => setInfo((current) => ({ ...current, [video]: next }))}
                    onRemove={() => setVideos((current) => current.filter((item) => item !== video))}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <ol className="how-steps" aria-label="How it works">
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
                <dd className={finder && !finderProblem ? undefined : 'model-warning'}>
                  {finder ?? 'No model chosen'}
                  {finder && runsOn && settings.llmProvider !== 'ollama' ? <span className="muted"> · {runsOn}</span> : null}
                  {finderProblem ? (<><br />{finderProblem}</>) : null}
                </dd>
              </div>
              <div>
                <dt>Speakers</dt>
                <dd>
                  {!settings.detectSpeakers || !speakersInstalled
                    ? 'Off'
                    : settings.speakersWhen === 'clip'
                      ? 'Detected per clip, when rendering'
                      : 'Detected on the whole video'}
                </dd>
              </div>
              <div>
                <dt>Reactions</dt>
                <dd>{settings.detectReactions && reactionsInstalled ? 'Heard, boosts clips that got laughs, cheers or gasps' : 'Off'}</dd>
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
              {settings.detectSpeakers && speakersInstalled ? (
                <div className="toggle-options" role="radiogroup" aria-label="When to detect speakers">
                  <label className="toggle">
                    <input
                      type="radio"
                      name="speakers-when"
                      checked={settings.speakersWhen === 'video'}
                      onChange={() => update({ speakersWhen: 'video' })}
                    />
                    <span>
                      <strong>Whole video, from the start</strong>
                      <span className="muted">
                        Slow on long videos. The AI knows who says what, so it spots back-and-forth moments better,
                        and each person keeps the same color in every clip.
                      </span>
                    </span>
                  </label>
                  <label className="toggle">
                    <input
                      type="radio"
                      name="speakers-when"
                      checked={settings.speakersWhen === 'clip'}
                      onChange={() => update({ speakersWhen: 'clip' })}
                    />
                    <span>
                      <strong>Each clip, when rendering</strong>
                      <span className="muted">
                        Much faster. Colors may differ between clips, and the AI picks moments without knowing who
                        speaks.
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}
              <label className={reactionsInstalled ? 'toggle' : 'toggle disabled'}>
                <input
                  type="checkbox"
                  disabled={!reactionsInstalled}
                  checked={settings.detectReactions && reactionsInstalled}
                  onChange={(event) => update({ detectReactions: event.target.checked })}
                />
                <span>
                  <strong>Reaction detection</strong>
                  <span className="muted">
                    {reactionsInstalled ? (
                      'Hears laughter, cheering, shouting, crying and gasps, so moments that got a reaction rank higher. About a minute per hour of video.'
                    ) : (
                      <>
                        Not downloaded ({formatBytes(bytesOf(REACTION_MODEL_IDS))}). Get it in <Link to="/models">Models</Link>.
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
        <button type="button" className="button primary large" disabled={videos.length === 0 || starting || checking} onClick={start}>
          {videos.length > 1 ? `Find clips in ${videos.length} videos` : 'Find clips'} →
        </button>
      </div>
    </div>
  )
}
