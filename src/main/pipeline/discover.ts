import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import type { Clip, ClipScores } from '../../shared/jobs'
import { log } from '../logger'
import { Cancelled, clock } from './run'
import type { Segment } from './transcribe'

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
          needs_earlier_context: { type: 'boolean' },
          scores: {
            type: 'object',
            properties: Object.fromEntries(
              ['hook', 'payoff', 'standalone', 'value'].map((key) => [key, { type: 'integer', minimum: 1, maximum: 5 }])
            ),
            required: ['hook', 'payoff', 'standalone', 'value']
          }
        },
        required: ['start_id', 'end_id', 'title', 'hook', 'category', 'rationale', 'payoff_quote', 'needs_earlier_context', 'scores']
      }
    }
  },
  required: ['moments']
}

function systemPrompt(minS: number, maxS: number): string {
  return `You are an expert short-form video editor. You find moments in a video transcript that work as standalone TikTok / Instagram Reels / YouTube Shorts clips of ${minS}-${maxS} seconds.

Transcript lines look like: [id] (m:ss) S1: text   (S1, S2… = speaker, when known)

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
- Return at most 3 moments for this excerpt, only genuinely strong ones. An empty list is fine.
- Pick start_id and end_id from the line ids. Never invent ids.
- Write title, hook and rationale in the transcript's language.
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
    if (child.exitCode !== null) throw new Error(`The AI model failed to start: ${tail.trim().split('\n').slice(-2).join(' ')}`)
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
  signal: AbortSignal
  onProgress: (fraction: number) => void
}): Promise<Clip[]> {
  const { segments } = opts
  const minMs = opts.minClipSeconds * 1000
  const maxMs = opts.maxClipSeconds * 1000
  const system = systemPrompt(opts.minClipSeconds, opts.maxClipSeconds)
  const hasSpeakers = segments.some((segment) => segment.speaker !== undefined)
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
      .map((s) => `[${s.id}] (${clock(s.start)}) ${hasSpeakers && s.speaker !== undefined ? `S${s.speaker + 1}: ` : ''}${s.text}`)
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
  while (length() < minMs && (b < segments.length - 1 || a > 0)) {
    if (b < segments.length - 1) b++
    else a--
    if (!notes.includes('extended to minimum length')) notes.push('extended to minimum length')
  }
  while (length() > maxMs && b > a) {
    b--
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
