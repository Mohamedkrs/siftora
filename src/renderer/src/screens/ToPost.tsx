import { useState } from 'react'
import { Link } from 'react-router-dom'
import { mediaUrl, type Clip, type Job } from '../../../shared/jobs'
import SharePanel from '../components/SharePanel'
import { useJobs } from '../state/jobs'

interface Item {
  job: Job
  clip: Clip
}

function clipSeconds(clip: Clip): number {
  return Math.round((clip.end - clip.start) / 1000)
}

function ToPostRow({ job, clip }: Item) {
  const { setClipPosted } = useJobs()
  const [sharing, setSharing] = useState(false)
  const path = clip.render.path as string

  // Same card as a reel on Results, so both screens look alike.
  return (
    <article className="card clip-card">
      <div className="clip-media">
        <video
          key={clip.render.at}
          className="clip-reel"
          src={`${mediaUrl(path)}?v=${clip.render.at ?? 0}`}
          controls
          // With a still to show, the reel loads only when played.
          preload={clip.render.poster ? 'none' : 'metadata'}
          poster={clip.render.poster ? `${mediaUrl(clip.render.poster)}?v=${clip.render.at ?? 0}` : undefined}
        />
      </div>
      <div className="clip-body">
        <div className="clip-head">
          <h3>{clip.title}</h3>
        </div>
        <p className="muted">
          <span className="tag">{clip.category}</span> {job.title} · {clipSeconds(clip)}s
        </p>
        <p>
          <strong>{clip.hook}</strong>
        </p>
        <p className="muted">{clip.rationale}</p>
        <div className="actions">
          <button type="button" className="button primary" onClick={() => setClipPosted(job.id, clip.id, true)}>
            Mark as posted
          </button>
          <button type="button" className="button" aria-pressed={sharing} onClick={() => setSharing((v) => !v)}>
            {sharing ? 'Hide share kit' : 'Share kit'}
          </button>
          <button type="button" className="button" onClick={() => void window.api.openPath(path)}>
            Open
          </button>
          <button type="button" className="button" onClick={() => void window.api.showInFolder(path)}>
            Show in folder
          </button>
        </div>
        {sharing ? <SharePanel clip={clip} reelPath={path} /> : null}
      </div>
    </article>
  )
}

export default function ToPost() {
  const { jobs, setClipPosted } = useJobs()
  const items: Item[] = []
  const posted: Item[] = []

  for (const job of jobs) {
    for (const clip of job.clips) {
      if (clip.render.status === 'done' && !clip.postedAt) items.push({ job, clip })
      if (clip.postedAt) posted.push({ job, clip })
    }
  }

  items.sort((a, b) => (b.clip.render.at ?? 0) - (a.clip.render.at ?? 0))
  posted.sort((a, b) => (b.clip.postedAt ?? 0) - (a.clip.postedAt ?? 0))

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>To post</h1>
        <p>Reels you rendered but have not marked as posted yet, newest first.</p>
      </div>

      {items.length === 0 ? (
        <p className="muted">
          Nothing to post. Rendered reels show up here until you mark them as posted.{' '}
          <Link to="/results">Go to Results</Link>
        </p>
      ) : (
        items.map((item) => <ToPostRow key={`${item.job.id}:${item.clip.id}`} job={item.job} clip={item.clip} />)
      )}

      {posted.length > 0 ? (
        <section className="card">
          <h2>Recently posted</h2>
          <ul className="posted-list">
            {posted.slice(0, 10).map(({ job, clip }) => (
              <li key={`${job.id}:${clip.id}`}>
                <strong>{clip.title}</strong>
                <span className="muted">{job.title}</span>
                <span className="muted">posted {new Date(clip.postedAt as number).toLocaleDateString()}</span>
                <button type="button" className="button small" onClick={() => setClipPosted(job.id, clip.id, false)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
