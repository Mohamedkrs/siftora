import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { mediaUrl, rangeKey, renderStyleKey, type Clip, type Job } from '../../../shared/jobs'
import CaptionStyle from '../components/CaptionStyle'
import { useDialog } from '../components/Dialog'
import SharePanel from '../components/SharePanel'
import VideoCard from '../components/VideoCard'
import { formatClock } from '../lib/format'
import { useJobs } from '../state/jobs'
import { useSettings } from '../state/settings'

function scoreClass(score: number): string {
  return score >= 75 ? 'score high' : score >= 55 ? 'score mid' : 'score low'
}

/** m:ss.t, precise enough to trim by. */
function clockTenths(ms: number): string {
  const tenths = Math.floor((ms % 1000) / 100)
  return `${formatClock(Math.floor(ms / 1000) * 1000)}.${tenths}`
}

function TrimRow(props: {
  label: string
  ms: number
  disabled: boolean
  onChange: (ms: number) => void
  onPlayhead: () => void
}) {
  return (
    <div className="trim-row">
      <span className="trim-label">{props.label}</span>
      <span className="trim-time">{clockTenths(props.ms)}</span>
      {[-1000, -100, 100, 1000].map((step) => (
        <button
          key={step}
          type="button"
          className="button small"
          disabled={props.disabled}
          onClick={() => props.onChange(props.ms + step)}
        >
          {step < 0 ? '−' : '+'}
          {Math.abs(step) / 1000}s
        </button>
      ))}
      <button type="button" className="button small" disabled={props.disabled} onClick={props.onPlayhead}>
        Set to playhead
      </button>
    </div>
  )
}

function ClipCard({ job, clip, rank, stale }: { job: Job; clip: Clip; rank: number; stale: boolean }) {
  const { render, deleteReel, setClipRange, setClipHeart, deleteClips } = useJobs()
  const dialog = useDialog()
  const [showText, setShowText] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const source = useRef<HTMLVideoElement>(null)
  // While adjusting the player runs freely (to find a new end); "Play clip" plays just the range.
  const stopAtEnd = useRef(true)
  const done = clip.render.status === 'done' && clip.render.path
  const busy = clip.render.status === 'queued' || clip.render.status === 'rendering'
  const lengthChanged = clip.render.range !== undefined && clip.render.range !== rangeKey(clip)
  const playhead = (): number => Math.round((source.current?.currentTime ?? 0) * 1000)
  const setRange = (start: number, end: number): void => setClipRange(job.id, clip.id, start, end)
  const toggleAdjust = (): void => {
    stopAtEnd.current = adjusting
    setAdjusting(!adjusting)
  }

  return (
    <article className="card clip-card">
      <div className="clip-media">
        {done && !adjusting ? (
          <video
            key={clip.render.at}
            className="clip-reel"
            src={`${mediaUrl(clip.render.path as string)}?v=${clip.render.at ?? 0}`}
            controls
            preload="metadata"
          />
        ) : job.videoPath ? (
          <video
            ref={source}
            className="clip-source"
            src={mediaUrl(job.videoPath)}
            controls
            preload="metadata"
            // Play only the clip's range of the source video (#t= fragments are not honoured here).
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = clip.start / 1000
            }}
            onTimeUpdate={(event) => {
              const video = event.currentTarget
              if (stopAtEnd.current && video.currentTime >= clip.end / 1000) {
                video.pause()
                video.currentTime = clip.start / 1000
                if (adjusting) stopAtEnd.current = false
              }
            }}
          />
        ) : null}
      </div>

      <div className="clip-body">
        <div className="clip-head">
          <h3>
            {rank}. {clip.title}
          </h3>
          <button
            type="button"
            className={clip.hearted ? 'heart-button on' : 'heart-button'}
            aria-pressed={clip.hearted === true}
            aria-label={clip.hearted ? 'Remove heart' : 'Heart this moment'}
            title={clip.hearted ? 'Remove heart' : 'Heart this moment; "Delete unhearted" keeps it'}
            onClick={() => setClipHeart(job.id, clip.id, !clip.hearted)}
          >
            {clip.hearted ? '♥' : '♡'}
          </button>
          <span className={scoreClass(clip.score)} title="Score out of 100">
            {clip.score}
          </span>
        </div>
        <p className="muted">
          <span className="tag">{clip.category}</span> {formatClock(clip.start)}–{formatClock(clip.end)} ·{' '}
          {Math.round((clip.end - clip.start) / 1000)}s
        </p>
        <p>
          <strong>{clip.hook}</strong>
        </p>
        <p className="muted">{clip.rationale}</p>
        {clip.notes.length > 0 ? (
          <p>
            {clip.notes.map((note) => (
              <span key={note} className="tag">
                {note}
              </span>
            ))}
          </p>
        ) : null}
        {adjusting ? (
          <div className="clip-trim">
            <TrimRow
              label="Start"
              ms={clip.start}
              disabled={busy}
              onChange={(ms) => setRange(ms, clip.end)}
              onPlayhead={() => setRange(playhead(), clip.end)}
            />
            <TrimRow
              label="End"
              ms={clip.end}
              disabled={busy}
              onChange={(ms) => setRange(clip.start, ms)}
              onPlayhead={() => setRange(clip.start, playhead())}
            />
            <div className="trim-actions">
              <button
                type="button"
                className="button small"
                onClick={() => {
                  const video = source.current
                  if (!video) return
                  stopAtEnd.current = true
                  video.currentTime = clip.start / 1000
                  void video.play()
                }}
              >
                Play clip
              </button>
              {clip.original ? (
                <button
                  type="button"
                  className="button small"
                  disabled={busy}
                  onClick={() => clip.original && setRange(clip.original.start, clip.original.end)}
                >
                  Reset to the AI&apos;s cut
                </button>
              ) : null}
              <span className="muted">Play past the end or scrub, then use “Set to playhead”.</span>
            </div>
          </div>
        ) : null}
        <button type="button" className="link-button" onClick={() => setShowText((v) => !v)}>
          {showText ? 'Hide transcript' : 'Show transcript'}
        </button>
        {showText ? <p className="clip-text">{clip.text}</p> : null}

        <div className="actions">
          <button type="button" className="button" disabled={busy} onClick={toggleAdjust} aria-pressed={adjusting}>
            {adjusting ? 'Done adjusting' : 'Adjust length'}
          </button>
          {done ? (
            <>
              <button type="button" className="button" aria-pressed={sharing} onClick={() => setSharing((v) => !v)}>
                {sharing ? 'Hide share kit' : 'Share'}
              </button>
              <button type="button" className="button primary" onClick={() => void window.api.openPath(clip.render.path as string)}>
                Open
              </button>
              <button type="button" className="button" onClick={() => void window.api.showInFolder(clip.render.path as string)}>
                Show in folder
              </button>
              <button type="button" className="button" onClick={() => render(job.id, [clip.id])}>
                Render again
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  void dialog
                    .confirm({
                      title: 'Delete this reel?',
                      message: 'The video file goes to the Recycle Bin. The clip stays here, so you can render it again.',
                      confirmLabel: 'Delete reel',
                      danger: true
                    })
                    .then((ok) => ok && deleteReel(job.id, clip.id))
                }}
              >
                Delete reel
              </button>
            </>
          ) : busy ? (
            <div className="clip-progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(clip.render.progress * 100)}%` }} />
              </div>
              <span className="muted">
                {clip.render.status === 'queued' ? 'Waiting…' : clip.render.message ?? `Rendering ${Math.round(clip.render.progress * 100)}%`}
              </span>
            </div>
          ) : (
            <button type="button" className="button primary" onClick={() => render(job.id, [clip.id])}>
              Render reel
            </button>
          )}
          {busy ? null : (
            <button
              type="button"
              className="button danger"
              onClick={() => {
                void dialog
                  .confirm({
                    title: 'Delete this moment?',
                    message: done
                      ? 'The moment is removed from this list and its reel goes to the Recycle Bin.'
                      : 'The moment is removed from this list. “Find moments again” can find it again.',
                    confirmLabel: 'Delete moment',
                    danger: true
                  })
                  .then((ok) => ok && deleteClips(job.id, [clip.id]))
              }}
            >
              Delete moment
            </button>
          )}
        </div>
        {sharing && done ? <SharePanel clip={clip} reelPath={clip.render.path} /> : null}
        {done && stale ? (
          <p className="stale-hint">
            {lengthChanged ? 'Length changed' : 'Caption style changed'} since this was rendered — render again to update it.
          </p>
        ) : null}
        {clip.render.status === 'error' ? <p className="error">{clip.render.error}</p> : null}
      </div>
    </article>
  )
}

/** The video last shown, so the sidebar's Results link comes back to it. */
let lastJobId: string | null = null

export default function Results() {
  const { jobs, render, findAgain, rewritePosts, deleteJob, deleteClips } = useJobs()
  const dialog = useDialog()
  const { settings } = useSettings()
  const [params, setParams] = useSearchParams()
  const [topic, setTopic] = useState<string | null>(null)
  const doneJobs = jobs.filter((job) => job.stage === 'done')
  const job =
    doneJobs.find((item) => item.id === params.get('job')) ?? doneJobs.find((item) => item.id === lastJobId) ?? doneJobs[0]
  lastJobId = job?.id ?? null

  if (!job) {
    return (
      <div className="screen">
        <div className="screen-head">
          <h1>Results</h1>
        </div>
        <p className="muted">
          No finished videos yet. Add one on <Link to="/create">Create</Link> and follow it in the <Link to="/queue">Queue</Link>.
        </p>
      </div>
    )
  }

  const clips = [...job.clips].sort((a, b) => b.score - a.score)
  const topics = new Map<string, number>()
  for (const clip of clips) topics.set(clip.category, (topics.get(clip.category) ?? 0) + 1)
  // A topic picked on another video, or whose last clip was deleted, shows everything again.
  const shownTopic = topic !== null && topics.has(topic) ? topic : null
  const notRendered = clips.filter((clip) => clip.render.status === 'idle' || clip.render.status === 'error')
  const reels = clips.filter((clip) => clip.render.status === 'done').length
  const rendering = clips.some((clip) => clip.render.status === 'queued' || clip.render.status === 'rendering')
  const removeVideo = (): void => {
    const what = [`${clips.length} clips`, reels > 0 ? `${reels} rendered ${reels === 1 ? 'reel' : 'reels'} (to the Recycle Bin)` : null]
      .filter(Boolean)
      .join(' and ')
    void dialog
      .confirm({
        title: `Delete "${job.title}"?`,
        message: `This removes its ${what}, and the transcript and analysis.\n\nYour original video file is not touched.`,
        confirmLabel: 'Delete',
        danger: true
      })
      .then((ok) => {
        if (!ok) return
        setParams({})
        deleteJob(job.id)
      })
  }
  const hearted = clips.filter((clip) => clip.hearted).length
  const unhearted = clips.filter(
    (clip) => !clip.hearted && clip.render.status !== 'queued' && clip.render.status !== 'rendering'
  )
  const deleteUnhearted = (): void => {
    const reelCount = unhearted.filter((clip) => clip.render.status === 'done').length
    void dialog
      .confirm({
        title: `Delete ${unhearted.length} unhearted ${unhearted.length === 1 ? 'moment' : 'moments'}?`,
        message: `The ${hearted} hearted ${hearted === 1 ? 'moment stays' : 'moments stay'}.${
          reelCount > 0 ? ` ${reelCount} rendered ${reelCount === 1 ? 'reel goes' : 'reels go'} to the Recycle Bin.` : ''
        }`,
        confirmLabel: 'Delete',
        danger: true
      })
      .then((ok) => ok && deleteClips(job.id, unhearted.map((clip) => clip.id)))
  }
  const styleKey = renderStyleKey(settings.subtitle, settings.layout)
  // Older reels have no saved range; only a known, different one counts as changed.
  const rangeChanged = (clip: Clip): boolean =>
    clip.render.status === 'done' && clip.render.range !== undefined && clip.render.range !== rangeKey(clip)
  const isStale = (clip: Clip): boolean =>
    (clip.render.status === 'done' && clip.render.style !== styleKey) || rangeChanged(clip)
  const stale = clips.filter(isStale)
  // Preview the style on the best clip: a frame just after it starts and its first caption line.
  const top = clips[0]
  const sample =
    top && job.videoPath
      ? { video: job.videoPath, atMs: top.start + 1500, words: top.text.split(/\s+/).filter(Boolean).slice(0, 3) }
      : undefined

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Results</h1>
      </div>

      {doneJobs.length > 1 ? (
        <nav className="video-strip" aria-label="Videos">
          {doneJobs.map((item) => (
            <VideoCard key={item.id} job={item} selected={item.id === job.id} onSelect={() => setParams({ job: item.id })} />
          ))}
        </nav>
      ) : null}

      <section className="card results-head">
        <div>
          <h2>{job.title}</h2>
          <p className="muted">
            {job.durationMs ? `${formatClock(job.durationMs)} · ` : ''}
            {clips.length} clips
            {hearted > 0 ? ` · ${hearted} hearted` : ''}
            {job.speakerCount ? ` · ${job.speakerCount} speakers` : ''}
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="button primary"
            disabled={notRendered.length === 0}
            onClick={() => render(job.id, notRendered.map((clip) => clip.id))}
          >
            Render all ({notRendered.length})
          </button>
          {stale.length > 0 ? (
            <button type="button" className="button" onClick={() => render(job.id, stale.map((clip) => clip.id))}>
              Update {stale.length} out of date
            </button>
          ) : null}
          <button type="button" className="button" onClick={() => void window.api.openPath(job.outputDir)}>
            Open output folder
          </button>
          <button
            type="button"
            className="button"
            disabled={rendering || clips.length === 0}
            title="Ask the AI for new titles, captions and descriptions; the clips stay as they are"
            onClick={() => rewritePosts(job.id)}
          >
            Rewrite post texts
          </button>
          <button type="button" className="button" onClick={() => findAgain(job.id)}>
            Find moments again
          </button>
          <button
            type="button"
            className="button danger"
            disabled={hearted === 0 || unhearted.length === 0}
            title={hearted === 0 ? 'Heart the moments you want to keep first' : 'Delete every moment without a heart'}
            onClick={deleteUnhearted}
          >
            Delete unhearted ({unhearted.length})
          </button>
          <button
            type="button"
            className="button danger icon-only"
            onClick={removeVideo}
            disabled={rendering}
            title={rendering ? 'Wait for rendering to finish' : 'Delete this video, its reels and data'}
            aria-label="Delete this video, its reels and data"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
            </svg>
          </button>
        </div>
      </section>

      {clips.length > 0 ? (
        <details className="card style-panel" open={clips.every((clip) => clip.render.status !== 'done')}>
          <summary>
            <h2>Caption style &amp; layout</h2>
            <span className="muted">Used for every reel you render; saved for future videos too.</span>
          </summary>
          <CaptionStyle
            sample={sample}
            speakerCount={job.speakerCount ?? 0}
            speakersPerClip={job.options.speakers && job.options.speakersWhen === 'clip'}
          />
        </details>
      ) : null}

      {clips.length === 0 ? (
        <p className="muted">
          No clips passed the minimum score. Lower it in Settings, then use “Find moments again”.
        </p>
      ) : (
        <>
          {topics.size > 1 ? (
            <div className="model-chips topic-filter" role="radiogroup" aria-label="Show moments by topic">
              <span className="chips-label">Show</span>
              {[null, ...topics.keys()].map((name) => (
                <button
                  key={name ?? 'all'}
                  type="button"
                  role="radio"
                  aria-checked={shownTopic === name}
                  className={shownTopic === name ? 'chip selected' : 'chip'}
                  onClick={() => setTopic(name)}
                >
                  {name === null ? `All (${clips.length})` : `${name[0].toUpperCase()}${name.slice(1)} (${topics.get(name)})`}
                </button>
              ))}
            </div>
          ) : null}
          {/* Rank stays the place in the full list, so it matches the reel's file name. */}
          {clips.map((clip, index) =>
            shownTopic === null || clip.category === shownTopic ? (
              <ClipCard key={clip.id} job={job} clip={clip} rank={index + 1} stale={isStale(clip)} />
            ) : null
          )}
        </>
      )}
    </div>
  )
}
