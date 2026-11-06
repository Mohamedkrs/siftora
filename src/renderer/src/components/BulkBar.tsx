import { useEffect, useRef } from 'react'
import type { Job } from '../../../shared/jobs'
import { isActive, useJobs } from '../state/jobs'
import { useDialog } from './Dialog'

const rendering = (job: Job): boolean =>
  job.clips.some((clip) => clip.render.status === 'queued' || clip.render.status === 'rendering')

/** "Select all" plus actions on the picked videos: find moments again, retry, delete. */
export default function BulkBar(props: { jobs: Job[]; selected: Set<string>; onSelect: (ids: Set<string>) => void }) {
  const { findAgain, retry, remove, deleteJob } = useJobs()
  const dialog = useDialog()
  const all = useRef<HTMLInputElement>(null)
  // Only what is shown counts, so a filter narrows "Select all" too.
  const picked = props.jobs.filter((job) => props.selected.has(job.id))
  const done = picked.filter((job) => job.stage === 'done')
  const failed = picked.filter((job) => job.stage === 'error' || job.stage === 'cancelled')
  // A video whose reels are rendering is kept; deleting it would pull files from under FFmpeg.
  const deletable = picked.filter((job) => !rendering(job))

  useEffect(() => {
    if (all.current) all.current.indeterminate = picked.length > 0 && picked.length < props.jobs.length
  })

  const clear = (): void => props.onSelect(new Set())
  const deleteAll = (): void => {
    const reels = deletable.reduce(
      (sum, job) => sum + job.clips.filter((clip) => clip.render.status === 'done').length,
      0
    )
    void dialog
      .confirm({
        title: `Delete ${deletable.length} ${deletable.length === 1 ? 'video' : 'videos'}?`,
        message: [
          `Their clips, transcripts and analysis are removed${reels > 0 ? `, and ${reels} rendered reels go to the Recycle Bin` : ''}.`,
          deletable.some((job) => isActive(job) || job.stage === 'queued')
            ? 'Ones still being processed are stopped.'
            : null,
          deletable.length < picked.length ? `${picked.length - deletable.length} rendering right now are kept.` : null,
          'Your original video files are not touched.'
        ]
          .filter(Boolean)
          .join('\n\n'),
        confirmLabel: 'Delete',
        danger: true
      })
      .then((ok) => {
        if (!ok) return
        for (const job of deletable) {
          // Finished videos have reels and an output folder to clean up; the rest only saved progress.
          if (job.stage === 'done') deleteJob(job.id)
          else remove(job.id)
        }
        clear()
      })
  }

  if (props.jobs.length < 2) return null
  return (
    <div className="bulk-bar">
      <label className="bulk-all">
        <input
          ref={all}
          type="checkbox"
          checked={picked.length > 0 && picked.length === props.jobs.length}
          onChange={(event) =>
            props.onSelect(event.target.checked ? new Set(props.jobs.map((job) => job.id)) : new Set())
          }
        />
        {picked.length > 0 ? `${picked.length} selected` : `Select all (${props.jobs.length})`}
      </label>
      <span className="bulk-actions" style={{ visibility: picked.length > 0 ? 'visible' : 'hidden' }}>
        <button
          type="button"
          className="button small"
          disabled={done.length === 0}
          title="Look for moments again in the finished videos; their found moments are replaced"
          onClick={() => {
            for (const job of done) findAgain(job.id)
            clear()
          }}
        >
          Find moments again ({done.length})
        </button>
        {failed.length > 0 ? (
          <button
            type="button"
            className="button small"
            onClick={() => {
              for (const job of failed) retry(job.id)
              clear()
            }}
          >
            Retry ({failed.length})
          </button>
        ) : null}
        <button type="button" className="button small danger" disabled={deletable.length === 0} onClick={deleteAll}>
          Delete ({deletable.length})
        </button>
        <button type="button" className="link-button" onClick={clear}>
          Clear
        </button>
      </span>
    </div>
  )
}
