import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { STAGE_LABELS, type Job } from '../../../shared/jobs'
import { formatClock } from '../lib/format'
import BulkBar from '../components/BulkBar'
import { useDialog } from '../components/Dialog'
import JobFilter, { matchesFilter, NO_FILTER } from '../components/JobFilter'
import { isActive, useJobs } from '../state/jobs'

function shortSource(source: string): string {
  return source.length > 70 ? `…${source.slice(-67)}` : source
}

function JobCard({ job, selected, onToggle }: { job: Job; selected: boolean; onToggle: () => void }) {
  const { cancel, remove, retry, findAgain } = useJobs()
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
        <span className={`stage-tag stage-${job.stage}`}>{STAGE_LABELS[job.stage]}</span>
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
      {job.error ? <p className="error">{job.error}</p> : null}

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
  const [filter, setFilter] = useState(NO_FILTER)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
  }
  const queued = all.filter((job) => !job.hiddenFromQueue)
  const jobs = queued.filter((job) => matchesFilter(job, filter))
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Queue</h1>
        <p>Videos being processed, one at a time. Finished steps are kept, so retries are quick.</p>
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
        jobs.map((job) => (
          <JobCard key={job.id} job={job} selected={selected.has(job.id)} onToggle={() => toggle(job.id)} />
        ))
      )}
    </div>
  )
}
