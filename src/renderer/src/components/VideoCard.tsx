import { mediaUrl, type Job } from '../../../shared/jobs'
import { formatClock } from '../lib/format'

/** A finished video: a frame from its best clip, its title and how far along it is. */
export default function VideoCard({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: () => void }) {
  const best = [...job.clips].sort((a, b) => b.score - a.score)[0]
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
        {job.videoPath ? (
          <video
            src={mediaUrl(job.videoPath)}
            muted
            preload="metadata"
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = (best?.start ?? 0) / 1000 + 1.5
            }}
          />
        ) : null}
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
