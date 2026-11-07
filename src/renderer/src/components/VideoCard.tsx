import { mediaUrl, type Job } from '../../../shared/jobs'
import { formatClock } from '../lib/format'

/** A finished video: a frame from its best clip, its title and how far along it is. */
export default function VideoCard({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: () => void }) {
  const rendered = job.clips.filter((clip) => clip.render.status === 'done').length
  return (
    <button
      type="button"
      className={selected ? 'video-card selected' : 'video-card'}
      aria-pressed={selected}
      onClick={onSelect}
      title={job.title}
    >
      <span className="video-card-frame">
        {/* A still made once, not the video: dozens of live <video> cards made Results lag. Blank until it exists. */}
        {job.thumb ? <img src={mediaUrl(job.thumb)} alt="" loading="lazy" decoding="async" /> : null}
      </span>
      <span className="video-card-text">
        <strong>{job.title}</strong>
        <span className="muted">
          {job.clips.length} clips{rendered > 0 ? ` · ${rendered} reels` : ''}
          {job.durationMs ? ` · ${formatClock(job.durationMs)}` : ''}
        </span>
      </span>
    </button>
  )
}
