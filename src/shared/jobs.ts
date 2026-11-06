// Jobs and clips shared by the pipeline (main) and the Queue/Results screens (renderer).
import type { CommentsSort, Layout, SubtitleStyle } from './types'

export type JobStage =
  | 'queued'
  | 'download' // web links
  | 'audio'
  | 'transcribe'
  | 'speakers'
  | 'reactions'
  | 'find' // moment discovery with the LLM
  | 'done'
  | 'error'
  | 'cancelled'

/** Options captured when the job is created, so later settings changes do not affect it. */
export interface JobOptions {
  useVad: boolean
  speakers: boolean
  /** Missing on older jobs = 'video'. */
  speakersWhen?: 'video' | 'clip'
  /** Missing on older jobs = off. */
  reactions?: boolean
  subtitle: SubtitleStyle
  layout: Layout
  language: string
  minClipSeconds: number
  maxClipSeconds: number
  /** 0-10; clips scoring below this (score/10) are not shown. */
  minScore: number
  /** Highest YouTube download height, picked per link on Create; missing = DEFAULT_YOUTUBE_HEIGHT. */
  youtubeMaxHeight?: number
  /** YouTube links only: download this many comments in this order. Missing = off. */
  comments?: { max: number; sort: CommentsSort }
}

/** YouTube quality when none was picked (the link check failed): best up to this height. */
export const DEFAULT_YOUTUBE_HEIGHT = 1080

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
  /** The AI's cut, kept once the user changes start/end by hand, so it can be restored. */
  original?: { start: number; end: number }
  /** The source channel's @handle, credited in the share kit. */
  credit?: string
  /** Marked as a keeper by the user; "Delete unhearted" spares it. */
  hearted?: boolean
  title: string
  hook: string
  /**
   * Written for sharing by a separate AI step: caption = first line in the feed, description,
   * hashtags (no '#'). Missing on clips found before that step; "Rewrite post texts" adds them.
   */
  caption?: string
  description?: string
  hashtags?: string[]
  category: string
  rationale: string
  scores: ClipScores
  /** 0-100. */
  score: number
  /** e.g. "extended to include the setup". */
  notes: string[]
  /** Transcript text of the clip. */
  text: string
  /**
   * style: renderStyleKey() of the look it was rendered with, to flag reels that are out of date.
   * at: when it finished; re-renders overwrite the same file, so the player URL needs it to reload.
   */
  /**
   * message: what a render is doing before the progress bar moves (e.g. finding speakers).
   * range: rangeKey() of the start/end it was rendered with, to flag reels whose length changed.
   */
  render: {
    status: RenderStatus
    progress: number
    path?: string
    error?: string
    style?: string
    at?: number
    message?: string
    range?: string
  }
}

export function rangeKey(clip: { start: number; end: number }): string {
  return `${clip.start}-${clip.end}`
}

export function renderStyleKey(subtitle: SubtitleStyle, layout: Layout): string {
  return JSON.stringify({ subtitle, layout })
}

export interface Job {
  id: string
  /** File path or web link. */
  source: string
  /** Local video file (same as source for files; set after download for URLs). */
  videoPath: string | null
  title: string
  /** Channel or uploader, for links (from yt-dlp's metadata). */
  channel?: string
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
  /** Removed from the Queue but kept, with its clips, on Results. */
  hiddenFromQueue?: boolean
  /** Queued to rewrite its clips' post texts only, keeping the clips. */
  rewritePosts?: boolean
}

/** URL the renderer can use in <video src> for a local file (served by the main process). */
export function mediaUrl(path: string): string {
  return `siftora-media://local/${encodeURIComponent(path)}`
}

export const STAGE_LABELS: Record<JobStage, string> = {
  queued: 'Waiting',
  download: 'Downloading video',
  audio: 'Preparing audio',
  transcribe: 'Transcribing',
  speakers: 'Detecting speakers',
  reactions: 'Listening for reactions',
  find: 'Finding moments',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled'
}
