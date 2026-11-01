import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import type { Clip, ClipScores } from '../../shared/jobs'
import { cleanHashtags } from '../../shared/share'
import { log } from '../logger'
import { SLICE_MS, type Reaction, type ReactionLevels } from './reactions'
import { Cancelled, clock } from './run'
import type { Segment, Word } from './transcribe'

/** YouTube's "Most replayed" graph: value 0-1, 1 = the most replayed part of the video. */
export interface ReplayPoint {
  start: number
  end: number
  value: number
}

/** Score points per 1.0 of replay above the video's average (a clip at the peak gains ~30-40). */
const REPLAY_BOOST = 50

// Reactions (audio tagging). Tuned on one comedy video; recheck on podcasts and streams.
const REACTION_AFTER_LINE_MS = 2000
const REACTION_AFTER_CLIP_MS = 6000
const REACTION_BOOST_CAP = 15

// Breathing room around a clip's first and last word.
const START_PAD_MS = 300
const END_PAD_MS = 800
/**
 * Per reaction: score points a clip gains when it got it, the note shown on the clip, and the
 * lowest level that counts. Crying is strict: silly noises scored up to 0.39 as "Whimper".
 */
const REACTION_SCORE: Record<Reaction, { boost: number; note: string; min: number }> = {
  laughter: { boost: 10, note: 'people laughed', min: 0.08 },
  cheering: { boost: 10, note: 'cheering or applause', min: 0.1 },
  gasp: { boost: 5, note: 'gasps', min: 0.1 },
  shouting: { boost: 5, note: 'shouting', min: 0.1 },
  crying: { boost: 5, note: 'crying', min: 0.5 }
}

const WINDOW_MS = 6 * 60_000
const STEP_MS = 4.5 * 60_000 // 1.5 min overlap so a setup and its payoff are not split

interface Moment {
  start_id: number
  end_id: number
  title: string
  hook: string
  category: string
  rationale: string
  payoff_quote: string
  description: string
  hashtags: string[]
  needs_earlier_context: boolean
  scores: ClipScores
}

const SCHEMA = {
  type: 'object',
  properties: {
    moments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start_id: { type: 'integer' },
          end_id: { type: 'integer' },
          title: { type: 'string' },
          hook: { type: 'string' },
          category: { type: 'string', enum: ['funny', 'educational', 'controversial', 'emotional', 'surprising', 'conversation'] },
          rationale: { type: 'string' },
          payoff_quote: { type: 'string' },
          description: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' }, maxItems: 6 },
          needs_earlier_context: { type: 'boolean' },
          scores: {
            type: 'object',
            properties: Object.fromEntries(
              ['hook', 'payoff', 'standalone', 'value'].map((key) => [key, { type: 'integer', minimum: 1, maximum: 5 }])
            ),
            required: ['hook', 'payoff', 'standalone', 'value']
          }
        },
        required: [
          'start_id',
          'end_id',
          'title',
          'hook',
          'category',
          'rationale',
          'payoff_quote',
          'description',
          'hashtags',
          'needs_earlier_context',
          'scores'
        ]
      }
    }
  },
  required: ['moments']
}

function systemPrompt(minS: number, maxS: number): string {
  return `You are an expert short-form video editor. You find moments in a video transcript that work as standalone TikTok / Instagram Reels / YouTube Shorts clips of ${minS}-${maxS} seconds.

Transcript lines look like: [id] (m:ss) S1: text   (S1, S2… = speaker, when known)
A line may end with sound markers: (laughter), (cheering), (shouting), (crying), (gasp). That sound was heard right there. Laughter and cheering mean a joke or payoff landed; gasps, shouting and crying mark surprise or strong emotion. Markers are not spoken text; never copy them into payoff_quote.

A good moment:
- starts where its setup starts (the question, the challenge, the situation) — never in the middle of it;
- grabs attention in the first seconds (surprising claim, question, strong opinion, joke setup, tension);
- contains its own payoff (punchline, answer, reveal, reaction) that is actually in the transcript;
- is understandable by someone who has not seen the rest of the video;
- starts and ends at complete sentences.

Rules:
- Swearing, shouting or a single funny word alone is NOT a hook or a payoff.
- payoff_quote: copy 3-12 words of the payoff EXACTLY as they appear in the transcript lines you selected. If you cannot, the moment has no real payoff — do not return it.
- needs_earlier_context: true if the clip only makes sense with something said just before start_id.
- When the payoff gets an immediate reaction (a laugh, "that was good", "no way"), end_id includes that reaction; do not end on the punchline itself.
- Return at most 3 moments for this excerpt, only genuinely strong ones. An empty list is fine.
- Pick start_id and end_id from the line ids. Never invent ids.
- Write title, hook, rationale and description in the transcript's language.
- description: 1-2 sentences for the post caption when the clip is shared; make people want to watch, no hashtags.
- hashtags: 3-6 hashtags that fit this clip (topic, people, format), as plain words without '#'.
- Scores 1-5: hook = how strongly the first seconds grab attention; payoff = how satisfying the ending is; standalone = understandable without context; value = entertainment or information value. Be strict: 5 is rare.`
}

export interface LlmClient {
  chat(system: string, user: string): Promise<string>
  close(): void
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

/** Starts the app's llama-server with the model and waits until it is ready. */
export async function startLlamaServer(binary: string, model: string, signal: AbortSignal): Promise<LlmClient> {
  const port = await freePort()
  const child: ChildProcess = spawn(
    binary,
    ['-m', model, '-ngl', '99', '-c', '16384', '--host', '127.0.0.1', '--port', String(port), '--jinja'],
    { windowsHide: true }
  )
  let tail = ''
  child.stderr?.on('data', (chunk: Buffer) => (tail = (tail + chunk.toString()).slice(-3000)))
  const close = (): void => {
    if (child.exitCode === null) child.kill()
  }
  signal.addEventListener('abort', close, { once: true })

  const base = `http://127.0.0.1:${port}`
  for (let i = 0; ; i++) {
    if (signal.aborted) throw new Cancelled()
    if (child.exitCode !== null) {
      const architecture = tail.match(/unknown model architecture: '([^']+)'/)?.[1]
      if (architecture) {
        throw new Error(
          `This llama.cpp is too old for this model (architecture "${architecture}"). Update it, or stop using it on the Models screen so Siftora uses its own.`
        )
      }
      throw new Error(`The AI model failed to start: ${tail.trim().split('\n').slice(-2).join(' ')}`)
    }
    try {
      if ((await fetch(`${base}/health`)).ok) break
    } catch {
      // not up yet
    }
    if (i > 600) {
      close()
      throw new Error('The AI model did not start within 5 minutes.')
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return {
    async chat(system, user) {
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          temperature: 0.3,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'moments', schema: SCHEMA } },
          chat_template_kwargs: { enable_thinking: false }
        })
      })
      if (!response.ok) throw new Error(`AI request failed: ${response.status} ${await response.text()}`)
      const body = (await response.json()) as { choices: { message: { content: string } }[] }
      return body.choices[0].message.content
    },
    close
  }
}

export function ollamaClient(model: string, signal: AbortSignal): LlmClient {
  const host = process.env.OLLAMA_HOST
  const base = !host ? 'http://127.0.0.1:11434' : host.startsWith('http') ? host.replace(/\/$/, '') : `http://${host}`
  return {
    async chat(system, user) {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: SCHEMA,
          options: { temperature: 0.3, num_ctx: 16384 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      })
      if (!response.ok) throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`)
      const body = (await response.json()) as { message: { content: string } }
      return body.message.content
    },
    close() {
      // Ollama manages its own model lifetime.
    }
  }
}

const norm = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Asks the LLM for moments window by window and turns them into checked, scored clips. */
export async function findMoments(opts: {
  client: LlmClient
  segments: Segment[]
  durationMs: number
  minClipSeconds: number
  maxClipSeconds: number
  minScore: number
  /** YouTube links only, and only when YouTube has enough views to show it. */
  replay?: ReplayPoint[]
  /** Reaction levels per SLICE_MS of audio, when reaction detection ran. */
  reactions?: ReactionLevels
  signal: AbortSignal
  onProgress: (fraction: number) => void
}): Promise<Clip[]> {
  const { segments } = opts
  const minMs = opts.minClipSeconds * 1000
  const maxMs = opts.maxClipSeconds * 1000
  const system = systemPrompt(opts.minClipSeconds, opts.maxClipSeconds)
  const hasSpeakers = segments.some((segment) => segment.speaker !== undefined)
  const { reactions } = opts
  const thresholds = reactions ? reactionThresholds(reactions) : null
  // A sound just after a line belongs to it (it is the reaction to what was said).
  const markers = (s: Segment): string =>
    reactions && thresholds
      ? reactionsBetween(reactions, thresholds, s.start, s.end + REACTION_AFTER_LINE_MS)
          .map((reaction) => ` (${reaction})`)
          .join('')
      : ''
  const windows = Math.max(1, Math.ceil((opts.durationMs - WINDOW_MS) / STEP_MS) + 1)
  const found: Clip[] = []
  let rejected = 0

  for (let w = 0; w < windows; w++) {
    if (opts.signal.aborted) throw new Cancelled()
    const from = w * STEP_MS
    const lines = segments.filter((segment) => segment.start >= from && segment.start < from + WINDOW_MS)
    opts.onProgress(w / windows)
    if (lines.length === 0) continue

    const user = lines
      .map(
        (s) =>
          `[${s.id}] (${clock(s.start)}) ${hasSpeakers && s.speaker !== undefined ? `S${s.speaker + 1}: ` : ''}${s.text}${markers(s)}`
      )
      .join('\n')
    let moments: Moment[] = []
    try {
      moments = (JSON.parse(await opts.client.chat(system, user)) as { moments: Moment[] }).moments ?? []
    } catch (err) {
      if (opts.signal.aborted) throw new Cancelled()
      log.warn('find', `window ${w + 1}/${windows} failed: ${String(err)}`)
      continue
    }

    const ids = new Set(lines.map((segment) => segment.id))
    for (const moment of moments) {
      if (!ids.has(moment.start_id) || !ids.has(moment.end_id) || moment.end_id < moment.start_id) {
        rejected++ // invented ids
        continue
      }
      const text = norm(segments.slice(moment.start_id, moment.end_id + 1).map((s) => s.text).join(' '))
      if (!moment.payoff_quote || !text.includes(norm(moment.payoff_quote))) {
        rejected++ // payoff not actually in the clip
        continue
      }
      found.push(refine(moment, segments, minMs, maxMs))
    }
  }
  opts.onProgress(1)
  log.info('find', `${found.length} moments found, ${rejected} rejected (invented ids or payoff not in transcript)`)

  if (opts.replay?.length) for (const clip of found) addReplay(clip, opts.replay)
  if (reactions && thresholds) for (const clip of found) addReactions(clip, reactions, thresholds)
  const words = segments.flatMap((segment) => segment.words ?? [])
  for (const clip of found) {
    const reactionEnd =
      reactions && thresholds ? lastReactionEnd(reactions, thresholds, clip.end, clip.end + REACTION_AFTER_CLIP_MS) : null
    finishEdges(clip, words, maxMs, reactionEnd)
  }

  return dedupe(found)
    .filter((clip) => clip.score >= opts.minScore * 10)
    .sort((a, b) => b.score - a.score)
}

function refine(moment: Moment, segments: Segment[], minMs: number, maxMs: number): Clip {
  let a = moment.start_id
  let b = moment.end_id
  const notes: string[] = []
  const length = (): number => segments[b].end - segments[a].start

  // Pull in the setup the model says is missing, while it fits.
  if (moment.needs_earlier_context) {
    for (let i = 0; i < 3 && a > 0 && segments[b].end - segments[a - 1].start <= maxMs; i++) a--
    if (a < moment.start_id) notes.push('extended to include the setup')
  }
  // The line where the payoff quote is complete; trimming never cuts it off.
  const quote = norm(moment.payoff_quote)
  let payoff = b
  for (let i = a; i <= b; i++) {
    if (norm(segments.slice(a, i + 1).map((s) => s.text).join(' ')).includes(quote)) {
      payoff = i
      break
    }
  }

  // Too short: add setup before the start first; a tail after the payoff only drags.
  while (length() < minMs && (a > 0 || b < segments.length - 1)) {
    if (a > 0) a--
    else b++
    if (!notes.includes('extended to minimum length')) notes.push('extended to minimum length')
  }
  // Too long: drop what follows the payoff, then the oldest lines, never the payoff itself.
  while (length() > maxMs && (b > payoff || a < payoff)) {
    if (b > payoff) b--
    else a++
    if (!notes.includes('trimmed to maximum length')) notes.push('trimmed to maximum length')
  }

  const s = moment.scores
  const average = 0.3 * s.hook + 0.25 * s.payoff + 0.3 * s.standalone + 0.15 * s.value
  return {
    id: `${segments[a].start}-${segments[b].end}`,
    start: segments[a].start,
    end: segments[b].end,
    title: moment.title,
    hook: moment.hook,
    description: moment.description,
    hashtags: cleanHashtags(moment.hashtags).slice(0, 6),
    category: moment.category,
    rationale: moment.rationale,
    scores: s,
    score: Math.round(((average - 1) / 4) * 100),
    notes,
    text: segments.slice(a, b + 1).map((segment) => segment.text).join(' '),
    render: { status: 'idle', progress: 0 }
  }
}

/** Average replay value over a time span, weighted by overlap; null when the graph does not cover it. */
function replayIn(replay: ReplayPoint[], start: number, end: number): number | null {
  let weighted = 0
  let covered = 0
  for (const point of replay) {
    const overlap = Math.min(point.end, end) - Math.max(point.start, start)
    if (overlap <= 0) continue
    weighted += point.value * overlap
    covered += overlap
  }
  return covered > 0 ? weighted / covered : null
}

/**
 * Raises or lowers a clip's score by how much more (or less) it was replayed than the video
 * on average. The graph peaks at 1 for every video, so only the difference means anything.
 */
export function addReplay(clip: Clip, replay: ReplayPoint[]): void {
  const replayed = replayIn(replay, clip.start, clip.end)
  const average = replayIn(replay, -Infinity, Infinity)
  if (replayed === null || average === null) return
  clip.score = Math.max(0, Math.min(100, Math.round(clip.score + REPLAY_BOOST * (replayed - average))))
  if (replayed - average >= 0.25) clip.notes.push('often replayed on YouTube')
}

/**
 * Per reaction, the level above which a slice counts. Sounds under speech score low (laughter
 * 0.1-0.47 in a comedy video, ~0.001 typical), so it is set per video: its top 10%, but at
 * least the reaction's min.
 */
export function reactionThresholds(levels: ReactionLevels): Record<Reaction, number> {
  const thresholds = {} as Record<Reaction, number>
  for (const reaction of Object.keys(REACTION_SCORE) as Reaction[]) {
    const sorted = [...(levels[reaction] ?? [])].sort((a, b) => a - b)
    thresholds[reaction] = Math.max(REACTION_SCORE[reaction].min, sorted[Math.floor(sorted.length * 0.9)] ?? 1)
  }
  return thresholds
}

/** Reactions heard in [start, end) ms. */
export function reactionsBetween(
  levels: ReactionLevels,
  thresholds: Record<Reaction, number>,
  start: number,
  end: number
): Reaction[] {
  return (Object.keys(REACTION_SCORE) as Reaction[]).filter((reaction) => {
    const values = levels[reaction] ?? []
    for (let i = Math.max(0, Math.floor(start / SLICE_MS)); i < values.length && i * SLICE_MS < end; i++) {
      if (values[i] >= thresholds[reaction]) return true
    }
    return false
  })
}

/** Raises the score of a clip that got a reaction, during it or just after its ending. */
export function addReactions(clip: Clip, levels: ReactionLevels, thresholds: Record<Reaction, number>): void {
  const heard = reactionsBetween(levels, thresholds, clip.start, clip.end + REACTION_AFTER_CLIP_MS)
  if (heard.length === 0) return
  const boost = Math.min(REACTION_BOOST_CAP, heard.reduce((sum, reaction) => sum + REACTION_SCORE[reaction].boost, 0))
  clip.score = Math.min(100, clip.score + boost)
  for (const reaction of heard) clip.notes.push(REACTION_SCORE[reaction].note)
}

/** End (ms) of the last slice in [start, end) where any reaction was heard, or null. */
function lastReactionEnd(
  levels: ReactionLevels,
  thresholds: Record<Reaction, number>,
  start: number,
  end: number
): number | null {
  for (let i = Math.ceil(end / SLICE_MS) - 1; i * SLICE_MS + SLICE_MS > start && i >= 0; i--) {
    if (reactionsBetween(levels, thresholds, i * SLICE_MS, (i + 1) * SLICE_MS).length > 0) return (i + 1) * SLICE_MS
  }
  return null
}

/**
 * Final cut points, between words: runs on to cover a reaction heard right after the clip
 * (still within maxMs), then adds a little breathing room on both sides without taking in
 * a neighbouring word. Whisper's word times run tight, so a cut right on them clips sounds.
 */
export function finishEdges(clip: Clip, words: Word[], maxMs: number, reactionEnd: number | null): void {
  if (reactionEnd !== null && reactionEnd > clip.end) {
    let end = Math.min(reactionEnd, clip.start + maxMs)
    const inside = words.find((word) => word.start < end && word.end > end)
    if (inside) end = inside.start // never cut through a word
    if (end > clip.end) {
      clip.end = end
      clip.notes.push('extended to include the reaction')
    }
  }
  const before = words.filter((word) => word.end <= clip.start).at(-1)
  const after = words.find((word) => word.start >= clip.end)
  clip.start = Math.max(0, before?.end ?? 0, clip.start - START_PAD_MS)
  clip.end = Math.min(after?.start ?? Infinity, clip.end + END_PAD_MS)
  const spoken = words.filter((word) => word.start >= clip.start && word.end <= clip.end)
  if (spoken.length > 0) clip.text = spoken.map((word) => word.text.trim()).join(' ')
  clip.id = `${clip.start}-${clip.end}`
}

function dedupe(clips: Clip[]): Clip[] {
  const kept: Clip[] = []
  for (const clip of [...clips].sort((x, y) => y.score - x.score)) {
    const clash = kept.some((k) => {
      const overlap = Math.min(k.end, clip.end) - Math.max(k.start, clip.start)
      return overlap > 0.5 * Math.min(k.end - k.start, clip.end - clip.start)
    })
    if (!clash) kept.push(clip)
  }
  return kept
}
