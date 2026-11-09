import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { STAGE_LABELS, type Job } from '../../../shared/jobs'
import { formatClock } from '../lib/format'
import BulkBar from '../components/BulkBar'
import { useKept } from '../lib/kept'
import { useDialog } from '../components/Dialog'
import JobFilter, { matchesFilter, NO_FILTER } from '../components/JobFilter'
import { isActive, useJobs } from '../state/jobs'

/** Engines by executable name, as a person would call them. */
const TOOLS: [RegExp, string][] = [
  [/audio-tagging/, 'Listening for reactions'],
  [/diariz|speaker/, 'Speaker detection'],
  [/whisper/, 'Transcription'],
  [/llama/, 'The AI model'],
  [/ffmpeg|ffprobe/, 'FFmpeg (the video tool)'],
  [/yt-dlp/, 'The download']
]

/** A crashed engine's raw output becomes one plain sentence; the raw text stays under Details. */
function friendlyError(error: string): { text: string; details?: string } {
  const crash = /^(\S+?)(?:\.exe)? exited with code (\d+)/.exec(error)
  if (!crash) return { text: error }
  const tool = TOOLS.find(([pattern]) => pattern.test(crash[1]))?.[1] ?? crash[1]
  return {
    text: `${tool} stopped unexpectedly. Retry the video; if it fails again, try a smaller model or turn that step off on Create.`,
    details: error
  }
}

function shortSource(source: string): string {
  return source.length > 70 ? `…${source.slice(-67)}` : source
}

function JobCard({ job, selected, onToggle }: { job: Job; selected: boolean; onToggle: () => void }) {
  const { cancel, remove, retry, findAgain, hold } = useJobs()
  const dialog = useDialog()
  const navigate = useNavigate()
  const active = isActive(job)
  const finished = ['done', 'error', 'cancelled'].includes(job.stage)

  return (
    <article className={`card job-card stage-${job.stage}`}>
      <div className="job-head">
        <div className="job-head-text">
          <h3 className="job-title">
            <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${job.title}`} />
            {job.title}
          </h3>
          <p className="muted" title={job.source}>
            {shortSource(job.source)}
            {job.channel ? ` · ${job.channel}` : ''} · added {new Date(job.createdAt).toLocaleString()}
          </p>
        </div>
        <span className={`stage-tag stage-${job.stage}`}>{job.held ? 'Paused' : STAGE_LABELS[job.stage]}</span>
      </div>

      {active ? (
        <div className="progress-track" role="progressbar" aria-valuenow={Math.round(job.progress * 100)}>
          <div className="progress-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      ) : null}

      <p className="muted">
        {[
          active ? `${Math.round(job.progress * 100)}%` : null,
          job.message,
          job.durationMs ? `${formatClock(job.durationMs)} long` : null,
          job.language ? `language: ${job.language}` : null,
          job.speakerCount ? `${job.speakerCount} speakers` : null
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {job.error
        ? (() => {
            const { text, details } = friendlyError(job.error)
            return (
              <>
                <p className="error">{text}</p>
                {details ? (
                  <details className="error-details">
                    <summary>Details</summary>
                    <code>{details}</code>
                  </details>
                ) : null}
              </>
            )
          })()
        : null}

      <div className="actions">
        {job.stage === 'done' ? (
          <>
            <button type="button" className="button primary" onClick={() => navigate(`/results?job=${job.id}`)}>
              View clips ({job.clips.length})
            </button>
            <button type="button" className="button" onClick={() => findAgain(job.id)}>
              Find moments again
            </button>
          </>
        ) : null}
        {job.stage === 'queued' ? (
          <button
            type="button"
            className="button"
            title={job.held ? undefined : 'Skip this video until you resume it'}
            onClick={() => hold(job.id, !job.held)}
          >
            {job.held ? 'Resume' : 'Pause'}
          </button>
        ) : null}
        {active || job.stage === 'queued' ? (
          <button type="button" className="button" onClick={() => cancel(job.id)}>
            Cancel
          </button>
        ) : null}
        {job.stage === 'error' || job.stage === 'cancelled' ? (
          <button type="button" className="button" onClick={() => retry(job.id)}>
            Retry
          </button>
        ) : null}
        {finished ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              void dialog
                .confirm({
                  title: `Remove "${job.title}" from the queue?`,
                  message:
                    job.stage === 'done'
                      ? 'Its clips stay on Results. To delete them, use Delete there.'
                      : 'Its saved progress is deleted.',
                  confirmLabel: 'Remove',
                  danger: job.stage !== 'done'
                })
                .then((ok) => ok && remove(job.id))
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
    </article>
  )
}

export default function Queue() {
  const { jobs: all } = useJobs()
  const [filter, setFilter] = useKept('queue:filter', NO_FILTER)
  const [selected, setSelected] = useKept<Set<string>>('queue:selected', new Set())
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try {
      return localStorage.getItem('queueView') === 'grid' ? 'grid' : 'list'
    } catch {
      return 'list'
    }
  })
  const pickView = (next: 'list' | 'grid'): void => {
    setView(next)
    try {
      localStorage.setItem('queueView', next)
    } catch {
      // Only a convenience.
    }
  }
  const held = all.filter((job) => job.stage === 'queued' && job.held).length
  const running = all.some((job) => isActive(job) || (job.stage === 'queued' && !job.held))
  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
  }
  const queued = all.filter((job) => !job.hiddenFromQueue)
  // The picker hides with one video left; a filter nobody can see or clear must not hide that video.
  const jobs = queued.length > 1 ? queued.filter((job) => matchesFilter(job, filter)) : queued
  return (
    <div className="screen">
      <div className="screen-head screen-head-row">
        <div>
          <h1>Queue</h1>
          <p>
            {held > 0 && !running
              ? 'Paused: no video is processed until you resume. Finished steps are kept.'
              : 'Videos being processed, one at a time. Finished steps are kept, so retries are quick.'}
          </p>
        </div>
        <div className="queue-head-actions">
          <div className="model-chips" role="radiogroup" aria-label="View">
            {(['list', 'grid'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                className={view === value ? 'chip selected' : 'chip'}
                onClick={() => pickView(value)}
              >
                {value === 'list' ? 'List' : 'Grid'}
              </button>
            ))}
          </div>
          {running ? (
            <button
              type="button"
              className="button"
              title="Stop the running video (it continues from its last finished step) and pause all waiting ones"
              onClick={() => void window.api.setQueuePaused(true)}
            >
              Pause all
            </button>
          ) : null}
          {held > 0 ? (
            <button type="button" className="button" onClick={() => void window.api.setQueuePaused(false)}>
              Resume all ({held})
            </button>
          ) : null}
        </div>
      </div>
      {queued.length > 1 ? <JobFilter jobs={queued} value={filter} onChange={setFilter} statuses /> : null}
      <BulkBar jobs={jobs} selected={selected} onSelect={setSelected} />
      {queued.length === 0 ? (
        <p className="muted">
          No videos yet — add some on the <Link to="/create">Create</Link> screen.
        </p>
      ) : jobs.length === 0 ? (
        <p className="muted">No videos match this filter.</p>
      ) : (
        <div className={view === 'grid' ? 'job-grid' : 'job-list'}>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} selected={selected.has(job.id)} onToggle={() => toggle(job.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
