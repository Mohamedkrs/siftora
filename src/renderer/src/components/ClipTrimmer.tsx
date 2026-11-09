import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import type { Clip } from '../../../shared/jobs'
import { formatClock } from '../lib/format'
import { useJobs } from '../state/jobs'

type Edge = 'start' | 'end'
interface Word {
  start: number
  end: number
  text: string
}

/** Same as the main process's minimum; shorter ranges are refused there. */
const MIN_MS = 1000
/** How much of the source the timeline shows around the clip (and the AI's cut). */
const PAD_MS = 20_000
/** Shorts and Reels stop at 3 minutes. */
const LONG_MS = 180_000

/** m:ss.t, precise enough to trim by. */
export function clockTenths(ms: number): string {
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

/**
 * Length editor under the source video: timeline with draggable ends, ± buttons, pick-by-word and
 * keyboard shortcuts. Every change shows the frame at the moved end in the player.
 */
export default function ClipTrimmer(props: {
  jobId: string
  clip: Clip
  /** 0 when unknown. */
  durationMs: number
  video: RefObject<HTMLVideoElement | null>
  disabled: boolean
  expanded: boolean
  onExpand: (expanded: boolean) => void
  onPlayClip: () => void
  /** Pause and show this moment, without the play-only-the-clip jump back. */
  seek: (ms: number) => void
}) {
  const { clip, video, disabled } = props
  const { setClipRange } = useJobs()
  const [drag, setDrag] = useState<{ edge: Edge; ms: number } | null>(null)
  const [words, setWords] = useState<Word[]>([])
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const playheadLine = useRef<HTMLDivElement>(null)

  const start = drag?.edge === 'start' ? drag.ms : clip.start
  const end = drag?.edge === 'end' ? drag.ms : clip.end
  // Window from the saved clip only, so it holds still while a handle is dragged.
  const lo = Math.min(clip.start, clip.original?.start ?? clip.start)
  const hi = Math.max(clip.end, clip.original?.end ?? clip.end)
  const winStart = Math.max(0, lo - PAD_MS)
  const winEnd = props.durationMs > 0 ? Math.min(props.durationMs, hi + PAD_MS) : hi + PAD_MS
  const pct = (ms: number): string =>
    `${((Math.min(Math.max(ms, winStart), winEnd) - winStart) / (winEnd - winStart)) * 100}%`
  const now = (): number => Math.round((video.current?.currentTime ?? 0) * 1000)

  /** Where a range end may go, given the other end. */
  const clamp = (edge: Edge, ms: number): number =>
    edge === 'start'
      ? Math.round(Math.min(Math.max(0, ms), clip.end - MIN_MS))
      : Math.round(Math.max(clip.start + MIN_MS, props.durationMs > 0 ? Math.min(props.durationMs, ms) : ms))
  /** show: jump the player to the new end; not when it was set from the playhead (it is already there, maybe playing). */
  const change = (edge: Edge, ms: number, show = true): void => {
    if (disabled) return
    const at = clamp(edge, ms)
    if (show) props.seek(at)
    if (edge === 'start') setClipRange(props.jobId, clip.id, at, clip.end)
    else setClipRange(props.jobId, clip.id, clip.start, at)
  }

  useEffect(() => {
    let live = true
    void window.api.clipWords(props.jobId, winStart, winEnd).then((list) => live && setWords(list))
    return () => {
      live = false
    }
  }, [props.jobId, winStart, winEnd])

  // Move the playhead line straight in the DOM; re-rendering the word list 60 times a second is waste.
  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      if (playheadLine.current) playheadLine.current.style.left = pct(now())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })

  // Shortcuts work anywhere in the clip's card (player included), not only on the trimmer.
  useEffect(() => {
    const card = root.current?.closest('article')
    if (!card) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (event.ctrlKey || event.metaKey || event.altKey || target.closest('input, textarea, select, [role="slider"]'))
        return
      const key = event.key.toLowerCase()
      const step = event.shiftKey ? 1000 : 100
      if (key === 'i') change('start', now(), false)
      else if (key === 'o') change('end', now(), false)
      else if (key === 'p') props.onPlayClip()
      else if (event.key === 'ArrowLeft') props.seek(now() - step)
      else if (event.key === 'ArrowRight') props.seek(now() + step)
      else if (event.key === ' ' && target.tagName !== 'BUTTON') {
        const player = video.current
        if (player) void (player.paused ? player.play() : player.pause())
      } else if (event.key === 'Escape' && props.expanded) props.onExpand(false)
      else return
      event.preventDefault()
    }
    card.addEventListener('keydown', onKey)
    return () => card.removeEventListener('keydown', onKey)
  })

  const msAt = (clientX: number): number => {
    const rect = (track.current as HTMLDivElement).getBoundingClientRect()
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    return Math.round(winStart + fraction * (winEnd - winStart))
  }
  const handle = (edge: Edge, ms: number) => ({
    role: 'slider',
    tabIndex: disabled ? -1 : 0,
    'aria-label': edge === 'start' ? 'Clip start' : 'Clip end',
    'aria-valuemin': winStart,
    'aria-valuemax': winEnd,
    'aria-valuenow': ms,
    'aria-valuetext': clockTenths(ms),
    className: `trim-handle ${edge}`,
    style: { left: pct(ms) },
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ edge, ms })
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drag?.edge !== edge) return
      const at = clamp(edge, msAt(event.clientX))
      setDrag({ edge, ms: at })
      props.seek(at)
    },
    onPointerUp: () => {
      if (drag?.edge !== edge) return
      change(edge, drag.ms)
      setDrag(null)
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 1000 : 100
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') change(edge, ms - step)
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') change(edge, ms + step)
      else return
      event.preventDefault()
    }
  })

  const length = end - start

  return (
    <div className="clip-trim" ref={root}>
      <div className="trim-timeline">
        <div
          ref={track}
          className="trim-track"
          title="Click to move the playhead"
          onPointerDown={(event) => props.seek(msAt(event.clientX))}
        >
          <div
            className="trim-range"
            style={{
              left: pct(start),
              width: `calc(${pct(end)} - ${pct(start)})`
            }}
          />
          {clip.original ? (
            <div
              className="trim-original"
              title="The AI's cut"
              style={{
                left: pct(clip.original.start),
                width: `calc(${pct(clip.original.end)} - ${pct(clip.original.start)})`
              }}
            />
          ) : null}
          <div ref={playheadLine} className="trim-playhead" />
          <div {...handle('start', start)} />
          <div {...handle('end', end)} />
        </div>
        <div className="trim-scale muted">
          <span>{clockTenths(winStart)}</span>
          <span className={length > LONG_MS ? 'trim-length long' : 'trim-length'}>
            Length {(length / 1000).toFixed(1)}s{length > LONG_MS ? ' — over 3 min, too long for Shorts and Reels' : ''}
          </span>
          <span>{clockTenths(winEnd)}</span>
        </div>
      </div>

      <TrimRow
        label="Start"
        ms={start}
        disabled={disabled}
        onChange={(ms) => change('start', ms)}
        onPlayhead={() => change('start', now(), false)}
      />
      <TrimRow
        label="End"
        ms={end}
        disabled={disabled}
        onChange={(ms) => change('end', ms)}
        onPlayhead={() => change('end', now(), false)}
      />

      <div className="trim-actions">
        <button type="button" className="button small" onClick={props.onPlayClip}>
          Play clip
        </button>
        {clip.original ? (
          <button
            type="button"
            className="button small"
            disabled={disabled}
            onClick={() => clip.original && setClipRange(props.jobId, clip.id, clip.original.start, clip.original.end)}
          >
            Reset to the AI&apos;s cut
          </button>
        ) : null}
      </div>
      <p className="trim-hint muted">
        Drag the ends of the bar, or play and press <kbd>I</kbd> / <kbd>O</kbd> to set the start / end at the playhead.{' '}
        <kbd>←</kbd> <kbd>→</kbd> step 0.1s (<kbd>Shift</kbd>: 1s), <kbd>Space</kbd> plays or pauses, <kbd>P</kbd> plays
        the clip.
      </p>

      {words.length > 0 ? (
        <div className="trim-words-box">
          <p className="trim-hint muted">
            <strong>Cut on a word:</strong> click a word to start the clip on it; <kbd>Shift</kbd>+click a word to end
            the clip right after it. Highlighted words are in the clip; hover a word to see its time.
          </p>
          <div className="trim-words">
            {words.map((word, index) => (
              <button
                key={index}
                type="button"
                className={word.start >= start && word.end <= end ? 'trim-word in' : 'trim-word'}
                title={`${clockTenths(word.start)} — click: start here, Shift+click: end here`}
                disabled={disabled}
                onClick={(event) => (event.shiftKey ? change('end', word.end) : change('start', word.start))}
              >
                {word.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
