// Jobs and clips shared by the pipeline (main) and the Queue/Results screens (renderer).
import type { Layout, SubtitleStyle } from './types'

export type JobStage =
  | 'queued'
  | 'download' // YouTube links
  | 'audio'
  | 'transcribe'
  | 'speakers'
  | 'find' // moment discovery with the LLM
  | 'done'
  | 'error'
  | 'cancelled'

/** Options captured when the job is created, so later settings changes do not affect it. */
export interface JobOptions {
  useVad: boolean
  speakers: boolean
  subtitle: SubtitleStyle
  layout: Layout
  language: string
  minClipSeconds: number
  maxClipSeconds: number
  /** 0-10; clips scoring below this (score/10) are not shown. */
  minScore: number
}

export interface ClipScores {
  hook: number
  payoff: number
  standalone: number
  value: number
}

export type RenderStatus = 'idle' | 'queued' | 'rendering' | 'done' | 'error'

export interface Clip {
  id: string
  /** Milliseconds in the source video. */
  start: number
  end: number
  title: string
  hook: string
  category: string
  rationale: string
  scores: ClipScores
  /** 0-100. */
  score: number
  /** e.g. "extended to include the setup". */
  notes: string[]
  /** Transcript text of the clip. */
  text: string
  render: { status: RenderStatus; progress: number; path?: string; error?: string }
}

export interface Job {
  id: string
  /** File path or YouTube URL. */
  source: string
  /** Local video file (same as source for files; set after download for URLs). */
  videoPath: string | null
  title: string
  createdAt: number
  options: JobOptions
  stage: JobStage
  /** 0-1 within the current stage. */
  progress: number
  message?: string
  error?: string
  durationMs?: number
  language?: string
  /** Number of speakers found (when speaker detection ran). */
  speakerCount?: number
  clips: Clip[]
  /** Folder the rendered reels go to. */
  outputDir: string
}

/** URL the renderer can use in <video src> for a local file (served by the main process). */
export function mediaUrl(path: string): string {
  return `vcf-media://local/${encodeURIComponent(path)}`
}

export const STAGE_LABELS: Record<JobStage, string> = {
  queued: 'Waiting',
  download: 'Downloading video',
  audio: 'Preparing audio',
  transcribe: 'Transcribing',
  speakers: 'Detecting speakers',
  find: 'Finding moments',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled'
}
