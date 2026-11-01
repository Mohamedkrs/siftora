import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { run } from './run'

export interface Word {
  start: number
  end: number
  text: string
}

export interface Segment {
  id: number
  start: number
  end: number
  text: string
  words: Word[]
  /** Speaker rank (0 = talks most), when speaker detection ran. */
  speaker?: number
}

export interface Transcript {
  language: string
  segments: Segment[]
}

type Progress = (fraction: number) => void

// DTW presets give word timings precise enough for karaoke captions.
const DTW_PRESETS: Record<string, string> = {
  'whisper-base': 'base',
  'whisper-small': 'small',
  'whisper-large-v3-turbo': 'large.v3.turbo',
  'whisper-large-v3': 'large.v3',
  'whisper-large-v3-turbo-q5': 'large.v3.turbo'
}

/** whisper.cpp tokens are sub-word pieces; a leading space starts a new word. */
function tokensToWords(tokens: { text?: string; t_dtw?: number; offsets: { from: number; to: number } }[]): Word[] {
  const words: Word[] = []
  for (const token of tokens) {
    if (!token.text || token.text.startsWith('[_')) continue
    const start = token.t_dtw && token.t_dtw > 0 ? token.t_dtw * 10 : token.offsets.from
    if (token.text.startsWith(' ') || words.length === 0) {
      words.push({ start, end: token.offsets.to, text: token.text.trim() })
    } else {
      const last = words[words.length - 1]
      last.text += token.text
      // Punctuation tokens are often timed after a pause; they must not stretch the word.
      if (/[\p{L}\p{N}]/u.test(token.text)) last.end = token.offsets.to
    }
  }
  return words.filter((word) => word.text.length > 0)
}

/** One kept stretch of speech: where it is in the original audio and in the trimmed audio (ms). */
interface VadSpan {
  orig: number
  origEnd: number
  vad: number
  vadEnd: number
}

const VAD_SPAN = /vad_segment_info: orig_start: ([\d.]+), orig_end: ([\d.]+), vad_start: ([\d.]+), vad_end: ([\d.]+)/

/**
 * Trimmed-audio time → original time, using the spans whisper.cpp logs with --vad. `edge` says
 * whether it is a word's start or end: in the short padding gap between two spans, an end
 * belongs to the speech before it and a start to the speech after it.
 */
export function vadToOriginal(spans: VadSpan[], ms: number, edge: 'start' | 'end'): number {
  if (spans.length === 0) return ms
  if (ms <= spans[0].vad) return spans[0].orig - (spans[0].vad - ms)
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i]
    if (ms <= span.vadEnd) return span.orig + (ms - span.vad)
    const next = spans[i + 1]
    if (next && ms < next.vad) {
      return edge === 'end' ? span.origEnd + (ms - span.vadEnd) : next.orig - (next.vad - ms)
    }
  }
  const last = spans[spans.length - 1]
  return last.origEnd + (ms - last.vadEnd)
}

/**
 * With --vad, whisper.cpp maps segment times back to the original timeline but leaves token
 * times in the silence-trimmed one, so words drift earlier as the video goes on. Transcripts
 * are now mapped exactly (vadToOriginal); this fallback, for transcripts saved before that,
 * stretches each segment's words onto the segment's own span. Words inside it are left alone.
 */
export function fitWordsToSegments(segments: Segment[]): Segment[] {
  for (const segment of segments) {
    const { words } = segment
    if (words.length === 0) continue
    const from = words[0].start
    const to = Math.max(words[words.length - 1].end, from + 1)
    if (from >= segment.start - 500 && to <= segment.end + 500) continue
    const scale = (segment.end - segment.start) / (to - from)
    const map = (ms: number): number => Math.round(segment.start + (ms - from) * scale)
    segment.words = words.map((word) => ({ ...word, start: map(word.start), end: map(word.end) }))
  }
  return segments
}

export async function transcribeWhisperCpp(opts: {
  binary: string
  model: string
  modelId: string | null
  vadModel: string | null
  wav: string
  workDir: string
  language: string
  signal: AbortSignal
  onProgress: Progress
}): Promise<Transcript> {
  const base = join(opts.workDir, 'whisper')
  const args = ['-m', opts.model, '-f', opts.wav, '-l', opts.language || 'auto', '-ojf', '-of', base, '-pp', '-sns']
  const dtw = opts.modelId ? DTW_PRESETS[opts.modelId] : undefined
  if (dtw) args.push('-dtw', dtw)
  if (opts.vadModel) args.push('--vad', '-vm', opts.vadModel)
  const spans: VadSpan[] = []
  await run(opts.binary, args, {
    signal: opts.signal,
    onStderr: (line) => {
      const match = line.match(/progress =\s*(\d+)%/)
      if (match) opts.onProgress(Number(match[1]) / 100)
      const span = line.match(VAD_SPAN)
      if (span) {
        const [orig, origEnd, vad, vadEnd] = span.slice(1).map((value) => Math.round(Number(value) * 1000))
        spans.push({ orig, origEnd, vad, vadEnd })
      }
    }
  })
  const raw = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as {
    result?: { language?: string }
    transcription: { text: string; offsets: { from: number; to: number }; tokens?: [] }[]
  }
  const segments = raw.transcription
    .map((item, id) => ({
      id,
      start: item.offsets.from,
      end: item.offsets.to,
      text: item.text.trim(),
      words: tokensToWords(item.tokens ?? []).map((word) => ({
        ...word,
        start: Math.round(vadToOriginal(spans, word.start, 'start')),
        end: Math.round(vadToOriginal(spans, word.end, 'end'))
      }))
    }))
    .filter((segment) => segment.text.length > 0)
  return { language: raw.result?.language ?? opts.language, segments: cleanLoops(fitWordsToSegments(segments)) }
}

export async function transcribePython(opts: {
  binary: string
  model: string
  wav: string
  workDir: string
  language: string
  signal: AbortSignal
  onProgress: Progress
}): Promise<Transcript> {
  const args = [
    opts.wav,
    '--model', opts.model,
    '--output_format', 'json',
    '--output_dir', opts.workDir,
    '--word_timestamps', 'True',
    // Not feeding previous text back in avoids most repetition loops.
    '--condition_on_previous_text', 'False',
    '--verbose', 'False'
  ]
  if (opts.language && opts.language !== 'auto') args.push('--language', opts.language)
  await run(opts.binary, args, {
    signal: opts.signal,
    onStderr: (line) => {
      const match = line.match(/(\d+)%\|/)
      if (match) opts.onProgress(Number(match[1]) / 100)
    }
  })
  const file = join(opts.workDir, `${basename(opts.wav).replace(/\.[^.]+$/, '')}.json`)
  if (!existsSync(file)) throw new Error('Whisper did not write a transcript.')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    language?: string
    segments: { start: number; end: number; text: string; words?: { word: string; start: number; end: number }[] }[]
  }
  const segments = raw.segments
    .map((item, id) => ({
      id,
      start: Math.round(item.start * 1000),
      end: Math.round(item.end * 1000),
      text: item.text.trim(),
      words: (item.words ?? [])
        .map((word) => ({ start: Math.round(word.start * 1000), end: Math.round(word.end * 1000), text: word.word.trim() }))
        .filter((word) => word.text.length > 0)
    }))
    .filter((segment) => segment.text.length > 0)
  return { language: raw.language ?? opts.language, segments: cleanLoops(segments) }
}

/** Whisper sometimes repeats one line over and over (on music/silence); keep only the first. */
export function cleanLoops(segments: Segment[]): Segment[] {
  const norm = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const kept: Segment[] = []
  for (const segment of segments) {
    const previous = kept[kept.length - 1]
    if (previous && norm(previous.text) === norm(segment.text)) continue
    kept.push(segment)
  }
  return kept.map((segment, id) => ({ ...segment, id }))
}
