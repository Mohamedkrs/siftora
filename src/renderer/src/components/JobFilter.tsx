import { STAGE_LABELS, type Job, type JobStage } from '../../../shared/jobs'

export interface JobFilterValue {
  channel: string
  /** Added in the last this many days; 0 = any time. */
  days: number
  /** '' = any status. */
  stage: JobStage | ''
}

export const NO_FILTER: JobFilterValue = { channel: '', days: 0, stage: '' }

export function matchesFilter(job: Job, filter: JobFilterValue): boolean {
  return (
    (!filter.channel || job.channel === filter.channel) &&
    (!filter.stage || job.stage === filter.stage) &&
    (!filter.days || job.createdAt >= Date.now() - filter.days * 86_400_000)
  )
}

/** Channel, "added" and (with `statuses`) status pickers over a list of videos. */
export default function JobFilter(props: {
  jobs: Job[]
  value: JobFilterValue
  onChange: (value: JobFilterValue) => void
  /** Offer a status picker (Queue; Results only has finished videos). */
  statuses?: boolean
}) {
  const channels = [...new Set(props.jobs.map((job) => job.channel).filter((name): name is string => !!name))].sort()
  return (
    <div className="job-filter">
      {channels.length > 0 ? (
        <select
          aria-label="Filter by channel"
          value={props.value.channel}
          onChange={(event) => props.onChange({ ...props.value, channel: event.target.value })}
        >
          <option value="">All channels</option>
          {channels.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
      {props.statuses ? (
        <select
          aria-label="Filter by status"
          value={props.value.stage}
          onChange={(event) => props.onChange({ ...props.value, stage: event.target.value as JobStage | '' })}
        >
          <option value="">All statuses</option>
          {(Object.keys(STAGE_LABELS) as JobStage[]).map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]} ({props.jobs.filter((job) => job.stage === stage).length})
            </option>
          ))}
        </select>
      ) : null}
      <select
        aria-label="Filter by date added"
        value={props.value.days}
        onChange={(event) => props.onChange({ ...props.value, days: Number(event.target.value) })}
      >
        <option value={0}>Added any time</option>
        <option value={1}>Added in the last 24 hours</option>
        <option value={7}>Added in the last 7 days</option>
        <option value={30}>Added in the last 30 days</option>
      </select>
    </div>
  )
}
