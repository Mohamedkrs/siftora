import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { mediaUrl, type Clip, type Job } from '../../../shared/jobs'
import { formatClock } from '../lib/format'
import { useJobs } from '../state/jobs'

function scoreClass(score: number): string {
  return score >= 75 ? 'score high' : score >= 55 ? 'score mid' : 'score low'
}

function ClipCard({ job, clip, rank }: { job: Job; clip: Clip; rank: number }) {
  const { render } = useJobs()
  const [showText, setShowText] = useState(false)
  const done = clip.render.status === 'done' && clip.render.path
  const busy = clip.render.status === 'queued' || clip.render.status === 'rendering'

  return (
    <article className="card clip-card">
      <div className="clip-media">
        {done ? (
          <video className="clip-reel" src={mediaUrl(clip.render.path as string)} controls preload="metadata" />
        ) : job.videoPath ? (
          <video
            className="clip-source"
            src={`${mediaUrl(job.videoPath)}#t=${clip.start / 1000},${clip.end / 1000}`}
            controls
            preload="metadata"
          />
        ) : null}
      </div>

      <div className="clip-body">
        <div className="clip-head">
          <h3>
            {rank}. {clip.title}
          </h3>
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
        <button type="button" className="link-button" onClick={() => setShowText((v) => !v)}>
          {showText ? 'Hide transcript' : 'Show transcript'}
        </button>
        {showText ? <p className="clip-text">{clip.text}</p> : null}

        <div className="actions">
          {done ? (
            <>
              <button type="button" className="button primary" onClick={() => void window.api.openPath(clip.render.path as string)}>
                Open
              </button>
              <button type="button" className="button" onClick={() => void window.api.showInFolder(clip.render.path as string)}>
                Show in folder
              </button>
              <button type="button" className="button" onClick={() => render(job.id, [clip.id])}>
                Render again
              </button>
            </>
          ) : busy ? (
            <div className="clip-progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(clip.render.progress * 100)}%` }} />
              </div>
              <span className="muted">
                {clip.render.status === 'queued' ? 'Waiting…' : `Rendering ${Math.round(clip.render.progress * 100)}%`}
              </span>
            </div>
          ) : (
            <button type="button" className="button primary" onClick={() => render(job.id, [clip.id])}>
              Render reel
            </button>
          )}
        </div>
        {clip.render.status === 'error' ? <p className="error">{clip.render.error}</p> : null}
      </div>
    </article>
  )
}

export default function Results() {
  const { jobs, render, findAgain } = useJobs()
  const [params, setParams] = useSearchParams()
  const doneJobs = jobs.filter((job) => job.stage === 'done')
  const job = doneJobs.find((item) => item.id === params.get('job')) ?? doneJobs[0]

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
  const notRendered = clips.filter((clip) => clip.render.status === 'idle' || clip.render.status === 'error')

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Results</h1>
        {doneJobs.length > 1 ? (
          <select value={job.id} onChange={(event) => setParams({ job: event.target.value })} aria-label="Video">
            {doneJobs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <section className="card results-head">
        <div>
          <h2>{job.title}</h2>
          <p className="muted">
            {job.durationMs ? `${formatClock(job.durationMs)} · ` : ''}
            {clips.length} clips
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
          <button type="button" className="button" onClick={() => void window.api.openPath(job.outputDir)}>
            Open output folder
          </button>
          <button type="button" className="button" onClick={() => findAgain(job.id)}>
            Find moments again
          </button>
        </div>
      </section>

      {clips.length === 0 ? (
        <p className="muted">
          No clips passed the minimum score. Lower it in Settings, then use “Find moments again”.
        </p>
      ) : (
        clips.map((clip, index) => <ClipCard key={clip.id} job={job} clip={clip} rank={index + 1} />)
      )}
    </div>
  )
}
