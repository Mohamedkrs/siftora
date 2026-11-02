import { useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CATALOG, REACTION_MODEL_IDS, llamaTooOld, SPEAKER_MODEL_IDS } from '../../../shared/catalog'
import { ENGINES, engineBytes, engineLabel, type EngineName } from '../../../shared/engines'
import { DEFAULT_YOUTUBE_HEIGHT, mediaUrl, type Job } from '../../../shared/jobs'
import type { ClipLimits, ModelState, YoutubeChoice, YoutubeInfo } from '../../../shared/types'
import ModelProgress from '../components/ModelProgress'
import NumberField from '../components/NumberField'
import SignInPicker from '../components/SignInPicker'
import VideoCard from '../components/VideoCard'
import { formatBytes, formatClock, formatEta } from '../lib/format'
import { useJobs } from '../state/jobs'
import { useModels } from '../state/models'
import { useOwnLlamaBuild, useSettings } from '../state/settings'

/** Any web link; yt-dlp knows YouTube, Facebook, TikTok, X, Instagram and many more. */
function isVideoUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** "facebook.com" for https://www.facebook.com/share/v/… */
function siteOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^(www|m)\./, '')
  } catch {
    return 'Link'
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

const SIGN_IN = 'Sign-in needed: '

const capital = (text: string): string => `${text[0].toUpperCase()}${text.slice(1)}`

/** Age-restricted / members-only link: walk the user through borrowing their browser's sign-in. */
function SignInHelp(props: { reason: string; onCheckAgain: () => void }) {
  const { settings } = useSettings()
  return (
    <span className="signin-help" role="alert">
      <strong>🔒 {capital(props.reason.slice(SIGN_IN.length))}</strong>
      <span>
        The site only shows it to a signed-in account. Sign in to it in your web browser (an adult account for
        age-restricted videos), then pick that browser so the downloader can use the sign-in.
      </span>
      <span className="signin-actions">
        <SignInPicker noneLabel="Choose your browser…" onChosen={props.onCheckAgain} />
        <button type="button" className="button small" disabled={!settings.cookiesBrowser} onClick={props.onCheckAgain}>
          Check again
        </button>
      </span>
      <span className="muted">
        Firefox works best. Chrome, Edge and Brave must be fully quit first, and newer versions may refuse anyway; then
        export a cookies.txt on youtube.com with an extension such as “Get cookies.txt LOCALLY” and pick “cookies.txt
        file…”.
      </span>
    </span>
  )
}

/** "20–45s · score 60+" */
function limitsText(limits: ClipLimits): string {
  return `${limits.minClipSeconds}–${limits.maxClipSeconds}s · score ${Math.round(limits.minScore * 10)}+`
}

/** Clip length and minimum score; on Create's side panel for all videos, or on one video's row. */
function ClipLimitFields(props: { limits: ClipLimits; onChange: (next: Partial<ClipLimits>) => void }) {
  const { limits, onChange } = props
  return (
    <>
      <div className="clip-length">
        <NumberField
          label="Shortest (s)"
          value={limits.minClipSeconds}
          min={1}
          max={limits.maxClipSeconds}
          tooBig={`Can't be longer than the longest (${limits.maxClipSeconds} s).`}
          onCommit={(minClipSeconds) => onChange({ minClipSeconds })}
        />
        <NumberField
          label="Longest (s)"
          value={limits.maxClipSeconds}
          min={limits.minClipSeconds}
          max={3600}
          tooSmall={`Can't be shorter than the shortest (${limits.minClipSeconds} s).`}
          tooBig="At most 3600 (an hour)."
          onCommit={(maxClipSeconds) => onChange({ maxClipSeconds })}
        />
      </div>
      <label className="field">
        Keep clips scoring at least {Math.round(limits.minScore * 10)}
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={limits.minScore}
          onChange={(event) => onChange({ minScore: Number(event.target.value) })}
        />
      </label>
    </>
  )
}

/** YouTube's video id, so youtu.be, watch?v=, shorts and live links of one video match. */
function youtubeId(link: string): string | null {
  try {
    const url = new URL(link)
    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null
    return url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1] ?? null
  } catch {
    return null
  }
}

/** Same file (Windows paths ignore case) or the same online video. */
function sameVideo(a: string, b: string): boolean {
  if (a === b) return true
  if (isVideoUrl(a) && isVideoUrl(b)) {
    const id = youtubeId(a)
    return id !== null && id === youtubeId(b)
  }
  return !isVideoUrl(a) && !isVideoUrl(b) && a.toLowerCase() === b.toLowerCase()
}

function timeAgo(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** A video waiting to be analysed: a frame, its name, length and resolution once known. */
function VideoRow(props: {
  source: string
  info?: VideoInfo
  /** YouTube links only: undefined while checking, a string when it failed. */
  youtube?: YoutubeInfo | string
  /** Quality picked on this row; else defaultHeight(). */
  quality?: number
  /** yt-dlp is still downloading (first link after install), so checking takes longer. */
  fetchingYtDlp: boolean
  /** Its download progress, once the first update arrived. */
  ytDlp?: ModelState
  onQuality: (height: number) => void
  onInfo: (info: VideoInfo) => void
  onRemove: () => void
  onCheckAgain: () => void
  /** Clip settings for this video only; undefined = the ones for all videos. */
  limits?: ClipLimits
  defaultLimits: ClipLimits
  onLimits: (limits: ClipLimits | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const youtube = isVideoUrl(props.source)
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
              ? props.youtube.startsWith(SIGN_IN)
                ? `${siteOf(props.source)} · needs you to sign in`
                : `${siteOf(props.source)} · could not check the link (${props.youtube})`
              : yt
                ? [
                    siteOf(props.source),
                    yt.durationMs ? formatClock(yt.durationMs) : null,
                    yt.heights.length ? `up to ${yt.heights[0]}p` : null
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : props.fetchingYtDlp
                  ? [
                      `${siteOf(props.source)} · downloading yt-dlp for links`,
                      props.ytDlp?.status === 'downloading' && props.ytDlp.totalBytes
                        ? `${Math.min(100, Math.round((props.ytDlp.receivedBytes / props.ytDlp.totalBytes) * 100))}%`
                        : '(about 40 MB)',
                      props.ytDlp?.status === 'downloading' && props.ytDlp.bytesPerSec > 0 ? `${formatBytes(props.ytDlp.bytesPerSec)}/s` : null,
                      props.ytDlp?.status === 'downloading' && props.ytDlp.etaSec ? `${formatEta(props.ytDlp.etaSec)} left` : null
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : `${siteOf(props.source)} · checking the link…`
            : [
                props.info ? formatClock(props.info.durationMs) : null,
                props.info?.height ? `${props.info.height}p` : null,
                folderOf(props.source)
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
        {typeof props.youtube === 'string' && props.youtube.startsWith(SIGN_IN) ? (
          <SignInHelp reason={props.youtube} onCheckAgain={props.onCheckAgain} />
        ) : null}
        <span className="video-row-limits">
          <button
            type="button"
            className="link-button"
            aria-expanded={editing}
            onClick={() => {
              if (!editing && !props.limits) {
                const { minClipSeconds, maxClipSeconds, minScore } = props.defaultLimits
                props.onLimits({ minClipSeconds, maxClipSeconds, minScore })
              }
              setEditing(!editing)
            }}
          >
            {props.limits ? `Clips: ${limitsText(props.limits)} (this video)` : 'Clips: same as all videos'}
          </button>
          {props.limits ? (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                props.onLimits(undefined)
                setEditing(false)
              }}
            >
              Use the settings for all
            </button>
          ) : null}
        </span>
        {editing && props.limits ? (
          <span className="video-row-limit-fields">
            <ClipLimitFields
              limits={props.limits}
              onChange={(next) => props.onLimits({ ...(props.limits as ClipLimits), ...next })}
            />
          </span>
        ) : null}
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
  const [limits, setLimits] = useState<Record<string, ClipLimits>>({})
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [starting, setStarting] = useState(false)
  /** How many videos the last "Find clips" queued; shown until more are added. */
  const [added, setAdded] = useState(0)
  /** Picked videos that Siftora already has; the user chooses: open its results or add it again. */
  const [already, setAlready] = useState<string[]>([])
  const [fetchingYtDlp, setFetchingYtDlp] = useState(false)

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

  const busy = (state: ModelState | undefined): boolean =>
    state !== undefined && ['queued', 'downloading', 'verifying', 'extracting'].includes(state.status)
  /** A catalog model that is chosen but not downloaded and not on its way, e.g. after a cancelled download. */
  const notDownloaded = (id: string | null): boolean =>
    id !== null && CATALOG.some((m) => m.id === id) && models[id]?.status !== 'installed' && !busy(models[id])
  const transcriberMissing = settings.transcriptionProvider !== 'openai-whisper' && notDownloaded(settings.transcriptionModel)
  const finderMissing = settings.llmProvider !== 'ollama' && notDownloaded(settings.llmModel)
  /** Progress of the chosen model and of the engine that runs it, while they download. */
  const progressOf = (id: string | null, engineName: EngineName, on: boolean): ReactNode =>
    on ? (
      <>
        {ENGINES.filter((entry) => entry.engine === engineName && busy(models[entry.id])).map((entry) => (
          <div key={entry.id} className="spaced">
            <span className="muted">{engineLabel(entry)}</span>
            <ModelProgress state={models[entry.id]} totalBytes={engineBytes(entry)} />
          </div>
        ))}
        {id && busy(models[id]) ? (
          <div className="spaced">
            <span className="muted">{modelName(id)}</span>
            <ModelProgress state={models[id]} totalBytes={CATALOG.find((m) => m.id === id)?.bytes ?? 0} />
          </div>
        ) : null}
      </>
    ) : null

  const stillDownloading = Object.values(models)
    .filter(busy)
    // yt-dlp only matters for web links.
    .filter((state) => state.id !== 'yt-dlp' || videos.some(isVideoUrl))
    .map((state) => {
      const engine = ENGINES.find((entry) => entry.id === state.id)
      return CATALOG.find((m) => m.id === state.id)?.name ?? (engine ? engineLabel(engine) : state.id)
    })

  const recent = jobs.filter((job) => job.stage === 'done').slice(0, 4)
  const totalMs = videos.reduce((sum, video) => {
    const yt = youtube[video]
    return sum + (info[video]?.durationMs ?? (typeof yt === 'object' ? yt.durationMs : 0))
  }, 0)
  const youtubeCount = videos.filter(isVideoUrl).length
  const checking = videos.some((video) => isVideoUrl(video) && youtube[video] === undefined)

  /** The earlier job for this video, unless it failed or was cancelled (then adding it again is normal). */
  const existingJob = (source: string): Job | undefined =>
    jobs.find((job) => job.stage !== 'error' && job.stage !== 'cancelled' && sameVideo(job.source, source))

  /** Adds new videos; ones Siftora already has wait in "Already added" unless `force`. Returns the ones added. */
  const addVideos = (paths: string[], force = false): string[] => {
    const clean = paths.filter((path) => path.trim().length > 0)
    const known = force ? [] : clean.filter((path) => existingJob(path))
    const fresh = clean.filter((path) => !known.includes(path))
    if (known.length > 0) setAlready((current) => Array.from(new Set([...current, ...known])))
    if (fresh.length > 0) setVideos((current) => Array.from(new Set([...current, ...fresh])))
    return fresh
  }

  const addAgain = (source: string): void => {
    setAlready((current) => current.filter((item) => item !== source))
    addVideos([source], true)
    if (isVideoUrl(source) && youtube[source] === undefined) checkLink(source)
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
    if (!isVideoUrl(value)) {
      setUrlError('Paste a link that starts with http:// or https://.')
      return
    }
    setUrlError('')
    setUrl('')
    if (addVideos([value]).length > 0 && youtube[value] === undefined) checkLink(value)
  }

  /** Looks the link up; again after the user picked a browser to sign in with. */
  const checkLink = (value: string): void => {
    setYoutube(({ [value]: _old, ...rest }) => rest) // back to "checking the link…"
    window.api
      .ytDlpInstalled()
      .then((installed) => setFetchingYtDlp(!installed))
      .catch(() => undefined)
    window.api
      .youtubeInfo(value)
      .then((result) => setYoutube((current) => ({ ...current, [value]: result })))
      .finally(() => setFetchingYtDlp(false))
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

  const start = (): void => {
    setStarting(true)
    // Send the shown default too, so every checked link downloads at what its row says.
    const links: Record<string, YoutubeChoice> = {}
    for (const video of videos) {
      const yt = youtube[video]
      const height = typeof yt === 'object' ? (quality[video] ?? defaultHeight(yt.heights)) : undefined
      if (typeof yt === 'object' && height !== undefined) links[video] = { height, title: yt.title }
    }
    void add(
      videos,
      links,
      Object.fromEntries(videos.flatMap((video) => (limits[video] ? [[video, limits[video]]] : [])))
    )
      .then(() => {
        setAdded(videos.length)
        setVideos([])
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
                placeholder="Paste a video link (YouTube, Facebook, TikTok…)"
                aria-label="Video link"
              />
              <button type="submit" className="button">
                Add
              </button>
            </form>
            {urlError ? <p className="error">{urlError}</p> : null}
          </section>

          {already.length > 0 ? (
            <section className="card already" role="status">
              <h2>Already in Siftora</h2>
              <ul className="already-rows">
                {already.map((source) => {
                  const job = existingJob(source)
                  if (!job) return null
                  const done = job.stage === 'done'
                  return (
                    <li key={source} className="already-row">
                      <VideoCard job={job} selected={false} onSelect={() => navigate(done ? `/results?job=${job.id}` : '/queue')} />
                      <div className="already-text">
                        <strong>{job.title}</strong>
                        <span className="muted">
                          Added {timeAgo(job.createdAt)} ·{' '}
                          {done ? `${job.clips.length} ${job.clips.length === 1 ? 'clip' : 'clips'} found` : 'still in the queue'}
                        </span>
                        <div className="already-actions">
                          <button
                            type="button"
                            className="button primary small"
                            onClick={() => navigate(done ? `/results?job=${job.id}` : '/queue')}
                          >
                            {done ? 'Go to results' : 'Open queue'} →
                          </button>
                          <button type="button" className="button small" onClick={() => addAgain(source)}>
                            Add again anyway
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setAlready((current) => current.filter((item) => item !== source))}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

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
                    fetchingYtDlp={fetchingYtDlp || busy(models['yt-dlp'])}
                    ytDlp={models['yt-dlp']}
                    onQuality={(height) => setQuality((current) => ({ ...current, [video]: height }))}
                    onInfo={(next) => setInfo((current) => ({ ...current, [video]: next }))}
                    onRemove={() => setVideos((current) => current.filter((item) => item !== video))}
                    onCheckAgain={() => checkLink(video)}
                    limits={limits[video]}
                    defaultLimits={settings}
                    onLimits={(next) =>
                      setLimits(({ [video]: _old, ...rest }) => (next ? { ...rest, [video]: next } : rest))
                    }
                  />
                ))}
              </ul>
            </section>
          ) : (
            <ol className="how-steps" aria-label="How it works">
              <li>
                <span className="step-dot one" aria-hidden="true" />
                <strong>Add a long video</strong>
                <span className="muted">A podcast, stream, interview or vlog. Files or links from YouTube, Facebook, TikTok and more.</span>
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
            {stillDownloading.length > 0 ? (
              <p className="model-warning" role="status">
                <strong>Still downloading: {stillDownloading.join(', ')}.</strong> Wait until it is done before you find clips, or they will stop at that step.
              </p>
            ) : null}
            <dl className="plan">
              <div>
                <dt>Transcribe</dt>
                <dd className={transcriber && !transcriberMissing ? undefined : 'model-warning'}>
                  {transcriber ?? 'No model chosen'}
                  {transcriber && runsOn && settings.transcriptionProvider !== 'openai-whisper' ? <span className="muted"> · {runsOn}</span> : null}
                  {transcriberMissing ? (<><br />Not downloaded. <Link to={`/models?model=${settings.transcriptionModel}`}>Download it</Link></>) : null}
                  {progressOf(settings.transcriptionModel, 'whisper', settings.transcriptionProvider !== 'openai-whisper')}
                </dd>
              </div>
              <div>
                <dt>Find moments</dt>
                <dd className={finder && !finderProblem && !finderMissing ? undefined : 'model-warning'}>
                  {finder ?? 'No model chosen'}
                  {finder && runsOn && settings.llmProvider !== 'ollama' ? <span className="muted"> · {runsOn}</span> : null}
                  {finderMissing ? (<><br />Not downloaded. <Link to={`/models?model=${settings.llmModel}`}>Download it</Link></>) : null}
                  {progressOf(settings.llmModel, 'llama', settings.llmProvider !== 'ollama')}
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
            <p className="muted">For all videos. To change one video only, use “Clips” on its row.</p>
            <ClipLimitFields limits={settings} onChange={update} />

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
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.readComments}
                  onChange={(event) => update({ readComments: event.target.checked })}
                />
                <span>
                  <strong>Read viewers' comments</strong>
                  <span className="muted">
                    YouTube links only. Comments like “14:22 I lost it” show what viewers loved, so titles and
                    descriptions hit the right angle. Makes the download slower (about a minute per 1,000 comments)
                    and needs a video with timestamped comments to help.
                  </span>
                </span>
              </label>
              {settings.readComments ? (
                <div className="video-row-limit-fields">
                  <NumberField
                    label="How many"
                    value={settings.commentsMax}
                    min={20}
                    max={5000}
                    onCommit={(commentsMax) => update({ commentsMax })}
                  />
                  <label className="field">
                    Which ones
                    <select
                      value={settings.commentsSort}
                      onChange={(event) => update({ commentsSort: event.target.value === 'new' ? 'new' : 'top' })}
                    >
                      <option value="top">Top (most liked)</option>
                      <option value="new">Newest</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
            <p className="muted small">Each video keeps the settings it was added with.</p>
          </section>
        </aside>
      </div>

      <div className="start-bar">
        <span className="muted" role="status">
          {videos.length === 0 && added > 0 ? (
            <span className="added-note">
              ✓ {added === 1 ? 'Video added' : `${added} videos added`} to the queue. <Link to="/queue">View queue</Link>
            </span>
          ) : videos.length === 0
            ? 'Add a video to start.'
            : [
                `${videos.length} ${videos.length === 1 ? 'video' : 'videos'}`,
                totalMs > 0 ? `${formatClock(totalMs)} of video` : null,
                youtubeCount > 0 ? `${youtubeCount} from the web` : null
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
