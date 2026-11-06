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
  needs_earlier_context: boolean
  scores: ClipScores
}

/**
 * Bump when the finder's prompt or scoring changes; saved with each found moment so
 * scripts/eval-clips.mjs can compare versions (2: reasons before choosing edges, video context, skip ads;
 * 3: soft minimum length, no padding moments that are only a little short).
 */
export const FINDER_VERSION = 3

// Fields are generated in this order: the reasoning comes before the edges and scores it justifies.
const SCHEMA = {
  type: 'object',
  properties: {
    moments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rationale: { type: 'string' },
          payoff_quote: { type: 'string' },
          start_id: { type: 'integer' },
          end_id: { type: 'integer' },
          needs_earlier_context: { type: 'boolean' },
          category: { type: 'string', enum: ['funny', 'educational', 'controversial', 'emotional', 'surprising', 'conversation'] },
          title: { type: 'string' },
          hook: { type: 'string' },
          scores: {
            type: 'object',
            properties: Object.fromEntries(
              ['hook', 'payoff', 'standalone', 'value'].map((key) => [key, { type: 'integer', minimum: 1, maximum: 5 }])
            ),
            required: ['hook', 'payoff', 'standalone', 'value']
          }
        },
        required: [
          'rationale',
          'payoff_quote',
          'start_id',
          'end_id',
          'needs_earlier_context',
          'category',
          'title',
          'hook',
          'scores'
        ]
      }
    }
  },
  required: ['moments']
}

function systemPrompt(minS: number, maxS: number): string {
  return `You are an expert short-form video editor. You find moments in a video transcript that work as standalone TikTok / Instagram Reels / YouTube Shorts clips of ${minS}-${maxS} seconds. That range is a target, not a rule: give each moment its natural length, and never add filler to reach ${minS} seconds.

The message starts with what the video is (title, channel, description, tags), when known. Use it to understand the format (a challenge, an interview, a stream…) and who is talking; it is not part of the transcript.

Transcript lines look like: [id] (m:ss) S1: text   (S1, S2… = speaker, when known)
A line may end with sound markers: (laughter), (cheering), (shouting), (crying), (gasp). That sound was heard right there. Laughter and cheering mean a joke or payoff landed; gasps, shouting and crying mark surprise or strong emotion. Markers are not spoken text; never copy them into payoff_quote.

A good moment:
- starts where its setup starts (the question, the challenge, the situation) — never in the middle of it;
- grabs attention in the first seconds (surprising claim, question, strong opinion, joke setup, tension);
- contains its own payoff (punchline, answer, reveal, reaction) that is actually in the transcript;
- is understandable by someone who has not seen the rest of the video;
- starts and ends at complete sentences.

Never pick:
- sponsor reads, ads and product plugs;
- intros, outros, "like and subscribe", channel news and other housekeeping;
- reading out donations, chat or comments, unless the reaction to them is the moment.

Rules:
- Fill the fields in order: first rationale (what happens and why it works as a clip) and payoff_quote, then choose start_id and end_id to fit them.
- Swearing, shouting or a single funny word alone is NOT a hook or a payoff.
- payoff_quote: copy 3-12 words of the payoff EXACTLY as they appear in the transcript lines you selected. If you cannot, the moment has no real payoff — do not return it.
- needs_earlier_context: true if the clip only makes sense with something said just before start_id.
- When the payoff gets an immediate reaction (a laugh, "that was good", "no way"), end_id includes that reaction; do not end on the punchline itself.
- Return at most 3 moments for this excerpt, only genuinely strong ones. An empty list is fine.
- Pick start_id and end_id from the line ids. Never invent ids.
- Write title, hook and rationale in the transcript's language.
- Scores 1-5: hook = how strongly the first seconds grab attention; payoff = how satisfying the ending is; standalone = understandable without context; value = entertainment or information value. Be strict: 5 is rare.`
}

export interface ChatOptions {
  /** JSON schema the reply must follow; defaults to the moments schema. */
  schema?: object
  temperature?: number
}

export interface LlmClient {
  chat(system: string, user: string, options?: ChatOptions): Promise<string>
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
    async chat(system, user, options = {}) {
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          temperature: options.temperature ?? 0.3,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'reply', schema: options.schema ?? SCHEMA } },
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
    async chat(system, user, options = {}) {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: options.schema ?? SCHEMA,
          options: { temperature: options.temperature ?? 0.3, num_ctx: 16384 },
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

const POST_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    caption: { type: 'string' },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' }, maxItems: 6 }
  },
  required: ['title', 'caption', 'description', 'hashtags']
}

const POST_PROMPT = `You write the post for one short-form clip (YouTube Shorts, TikTok, Instagram Reels) cut from a longer video. You get the long video's title, channel, upload date, language, category, description, tags and the creator's hashtags (its format and who is in it), the chapter the clip is in, viewers' comments about this moment, what kind of moment the clip is, sounds the audience made, and the clip's transcript.

Write, in the transcript's language:
- title: max 60 characters. Make a stranger curious enough to watch. Be specific to this clip: name the channel's host or a guest when the transcript shows they are in it, and the situation (the challenge, the game, the topic). Do not give away the punchline. No quotation marks, no ALL CAPS, no emoji, no clickbait the clip does not deliver.
- caption: the first line people see in the feed, max 100 characters. Sets up the moment in your own words; never a quote copied from the transcript.
- description: 1-2 sentences, max 200 characters. Tells a stranger who is in it, what the setup is and what happens, and why it is worth watching. Your own words, no hashtags.
- hashtags: 3-6 plain words without '#': the host or show, the format (e.g. trynottolaugh, podcast), the topic. Reuse the creator's hashtags when they fit this clip.

Rules:
- Only describe what the context and the transcript show. Never invent people, roles (like a heckler or a host), places or events.
- Use the video's format from its title, description and tags: if it is a challenge or game, say so.
- The chapter title, when given, is the creator's own name for this part of the video: use it to understand the topic.
- Viewers' comments show what people noticed or loved in this moment: use them to pick the angle. Never copy them, quote them or take names from them.
- Do not call the video new or recent unless the upload date is in the last few weeks.
- The transcript comes from speech recognition: ignore filler, false starts and misheard words; never repeat them.
- Speech recognition mishears names. Spell names the way the video title, description or tags spell them. If you cannot tell who someone is, say what they are (a comedian, a guest) instead of guessing a name.
- Say what actually happens. Never use filler like hilarious, wild, chaos, epic, "you won't believe", "worth watching", "don't miss".
- The caption must not repeat the title; it adds the setup or the stakes.`

/** "14:22", "1:02:33": a time a viewer points at in a comment, in ms. */
const TIMESTAMP = /\b(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)\b/g

/** Up to 5 most-liked comments that point inside the clip (or just before it, as people round down). */
export function momentComments(comments: { text: string; like_count?: number }[], clip: { start: number; end: number }): string[] {
  return comments
    .filter((comment) =>
      [...comment.text.matchAll(TIMESTAMP)].some(([, h, m, s]) => {
        const ms = ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000
        return ms >= clip.start - 5000 && ms <= clip.end
      })
    )
    .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
    .slice(0, 5)
    .map((comment) => comment.text.replace(/\s+/g, ' ').slice(0, 200))
}

/**
 * Writes each clip's title, feed caption, description and hashtags in its own call, with the
 * whole clip in view. The moment search only drafts a working title on the side.
 */
export async function writePosts(opts: {
  client: LlmClient
  clips: Clip[]
  segments: Segment[]
  /** Long video's title, channel, description and tags, one per line. */
  videoContext: string
  /** The creator's chapters (seconds), for links that have them. */
  chapters?: { start_time: number; end_time: number; title: string }[]
  /** The channel's @handle, credited in the share kit. */
  credit?: string
  /** Viewers' comments, when downloaded; the ones with a timestamp inside a clip go with it. */
  comments?: { text: string; like_count?: number }[]
  signal: AbortSignal
  onProgress: (fraction: number) => void
}): Promise<void> {
  for (const [i, clip] of opts.clips.entries()) {
    if (opts.signal.aborted) throw new Cancelled()
    opts.onProgress(i / opts.clips.length)
    const lines = opts.segments
      .filter((s) => s.end > clip.start && s.start < clip.end)
      .map((s) => `${s.speaker !== undefined ? `S${s.speaker + 1}: ` : ''}${s.text}`)
    const chapter = opts.chapters?.find((c) => c.start_time * 1000 <= clip.start && clip.start < c.end_time * 1000)
    const said = momentComments(opts.comments ?? [], clip)
    const sounds = clip.notes.filter((note) => /laughed|cheering|gasps|shouting|crying/.test(note))
    const user = [
      opts.videoContext,
      chapter ? `Chapter: ${chapter.title}` : null,
      said.length > 0 ? `Viewers' comments about this moment:\n${said.map((text) => `- ${text}`).join('\n')}` : null,
      `Kind of moment: ${clip.category}`,
      sounds.length > 0 ? `Audience: ${sounds.join(', ')}` : null,
      `Clip transcript:\n${lines.join('\n')}`
    ]
      .filter(Boolean)
      .join('\n')
    clip.credit = opts.credit
    try {
      const post = JSON.parse(await opts.client.chat(POST_PROMPT, user, { schema: POST_SCHEMA, temperature: 0.7 })) as {
        title?: string
        caption?: string
        description?: string
        hashtags?: unknown
      }
      if (post.title?.trim()) clip.title = post.title.trim().replace(/^["']|["']$/g, '')
      if (post.caption?.trim()) clip.caption = post.caption.trim()
      if (post.description?.trim()) clip.description = post.description.trim()
      const tags = cleanHashtags(post.hashtags).slice(0, 6)
      if (tags.length > 0) clip.hashtags = tags
    } catch (err) {
      if (opts.signal.aborted) throw new Cancelled()
      log.warn('find', `writing the post for "${clip.title}" failed: ${String(err)}`)
    }
  }
  opts.onProgress(1)
}

/** Asks the LLM for moments window by window and turns them into checked, scored clips. */
export async function findMoments(opts: {
  client: LlmClient
  segments: Segment[]
  durationMs: number
  minClipSeconds: number
  maxClipSeconds: number
  minScore: number
  /** What the video is: title, channel, description, tags. */
  videoContext?: string
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

    const transcript = lines
      .map(
        (s) =>
          `[${s.id}] (${clock(s.start)}) ${hasSpeakers && s.speaker !== undefined ? `S${s.speaker + 1}: ` : ''}${s.text}${markers(s)}`
      )
      .join('\n')
    const user = opts.videoContext ? `${opts.videoContext}\n\nTranscript:\n${transcript}` : transcript
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

  // Well short: add up to 2 lines of setup (a tail after the payoff only drags). A complete moment
  // a little under the minimum stays as cut; padding it only adds lines viewers swipe past.
  if (length() < minMs * 0.6) {
    for (let i = 0; i < 2 && length() < minMs && (a > 0 || b < segments.length - 1); i++) {
      if (a > 0) a--
      else b++
      if (i === 0) notes.push('extended to minimum length')
    }
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
