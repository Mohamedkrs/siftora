import { app } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Clip, Job } from '../shared/jobs'
import { log } from './logger'
import { FINDER_VERSION } from './pipeline/discover'
import { getSettings } from './settings'

/**
 * What the user does with found moments, one JSON object per line in feedback.jsonl (data folder).
 * Stays on this computer; scripts/eval-clips.mjs reads it to measure how good the picks are.
 * found = everything the finder suggested; heart / unheart / delete / trim / render = the user's choices.
 */
export type FeedbackAction = 'found' | 'heart' | 'unheart' | 'delete' | 'trim' | 'render'

function clipFeatures(clip: Clip, rank: number): Record<string, unknown> {
  return {
    clipId: clip.id,
    rank,
    start: clip.start,
    end: clip.end,
    // The finder's cut, when the user changed it.
    original: clip.original,
    score: clip.score,
    scores: clip.scores,
    category: clip.category,
    notes: clip.notes,
    hearted: clip.hearted === true
  }
}

export function logFeedback(job: Job, action: FeedbackAction, clips: Clip[]): void {
  if (clips.length === 0) return
  const settings = getSettings()
  const byScore = [...job.clips].sort((a, b) => b.score - a.score)
  const base = {
    at: new Date().toISOString(),
    action,
    jobId: job.id,
    source: job.source,
    durationMs: job.durationMs
  }
  const found =
    action === 'found'
      ? {
          appVersion: app.getVersion(),
          finder: settings.llmProvider === 'ollama' ? `ollama:${settings.ollamaModel}` : settings.llmModel,
          finderVersion: FINDER_VERSION,
          transcriber:
            settings.transcriptionProvider === 'openai-whisper' ? `openai-whisper:${settings.openaiWhisperModel}` : settings.transcriptionModel,
          reactions: job.options.reactions === true,
          speakers: job.options.speakers,
          minScore: job.options.minScore,
          minClipSeconds: job.options.minClipSeconds,
          maxClipSeconds: job.options.maxClipSeconds
        }
      : {}
  const lines = clips.map((clip) => JSON.stringify({ ...base, ...found, ...clipFeatures(clip, byScore.indexOf(clip) + 1) }))
  try {
    appendFileSync(join(app.getPath('userData'), 'feedback.jsonl'), `${lines.join('\n')}\n`)
  } catch (err) {
    // Feedback is a nice-to-have; never let it break the action itself.
    log.warn('feedback', `could not write: ${String(err)}`)
  }
}
