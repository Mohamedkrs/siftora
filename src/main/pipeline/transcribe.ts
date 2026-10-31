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
      last.end = token.offsets.to
    }
  }
  return words.filter((word) => word.text.length > 0)
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
  await run(opts.binary, args, {
    signal: opts.signal,
    onStderr: (line) => {
      const match = line.match(/progress =\s*(\d+)%/)
      if (match) opts.onProgress(Number(match[1]) / 100)
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
      words: tokensToWords(item.tokens ?? [])
    }))
    .filter((segment) => segment.text.length > 0)
  return { language: raw.result?.language ?? opts.language, segments: cleanLoops(segments) }
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
