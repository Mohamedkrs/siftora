import { Link } from 'react-router-dom'
import { useJobs } from '../state/jobs'
import { useSettings } from '../state/settings'

/** First steps for new users; each ticks itself off from what is already done, and the card goes once all are. */
export default function GettingStarted() {
  const { settings, update } = useSettings()
  const { jobs } = useJobs()
  const clips = jobs.flatMap((job) => job.clips)
  const steps = [
    { done: jobs.length > 0, text: <>Add a video, a link or a channel below, then press <b>Find clips</b>.</> },
    {
      done: jobs.some((job) => job.stage === 'done'),
      text: <>Follow the progress on <Link to="/queue">Queue</Link>. The first video takes longest.</>
    },
    {
      done: clips.some((clip) => clip.hearted || clip.original),
      text: <>On <Link to="/results">Results</Link>, heart the moments you like or adjust their length.</>
    },
    { done: clips.some((clip) => clip.render.status === 'done'), text: <>Pick a caption style and render a reel.</> }
  ]
  if (settings.gettingStartedHidden || steps.every((step) => step.done)) return null
  return (
    <section className="card getting-started">
      <div className="getting-started-head">
        <h2>Getting started</h2>
        <button type="button" className="link-button" onClick={() => update({ gettingStartedHidden: true })}>
          Hide
        </button>
      </div>
      <ol>
        {steps.map((step, index) => (
          <li key={index} className={step.done ? 'done' : undefined}>
            <span className="getting-started-mark" aria-label={step.done ? 'Done' : 'To do'}>
              {step.done ? '✓' : index + 1}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
      <p className="hint">
        Tip: save your favourite channels on <Link to="/channels">Channels</Link> to add their newest videos in one go.
      </p>
    </section>
  )
}
