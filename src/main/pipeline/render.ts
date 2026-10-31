import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Clip } from '../../shared/jobs'
import { CAPTION_FONTS, type Layout, type SubtitleStyle } from '../../shared/types'
import { run } from './run'
import type { Segment, Word } from './transcribe'

const W = 1080
const H = 1920
const WORDS_PER_LINE = 3

/** Bundled caption fonts: resources/fonts in dev, <resources>/fonts when packaged. */
function fontsSource(): string {
  return app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'resources', 'fonts')
}

/** "#RRGGBB" → ASS "&H00BBGGRR". */
function assColor(hex: string, alpha = '00'): string {
  const h = hex.replace('#', '')
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}

function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

const clean = (text: string): string => text.replace(/[{}\\]/g, '')

/**
 * Builds the .ass captions for one clip. Words appear in short lines; with "highlight" on,
 * one event per word colours only the word being spoken (like the preview).
 */
export function buildAss(clip: Clip, segments: Segment[], style: SubtitleStyle): string {
  const weight = CAPTION_FONTS.find((font) => font.family === style.font)?.weight ?? 800
  const outline = style.outline ? Math.max(2, Math.round(style.sizePx * 0.08)) : 0
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.font},${style.sizePx},${assColor(style.color)},${assColor(style.color)},${assColor(style.outlineColor)},&H80000000,${weight >= 700 ? -1 : 0},0,0,0,100,100,0,0,1,${outline},${style.outline ? 0 : 2},5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const y = Math.round((style.positionY / 100) * H)
  const pos = `{\\an5\\pos(${W / 2},${y})}`
  const events: string[] = []

  for (const segment of segments) {
    if (segment.end <= clip.start || segment.start >= clip.end) continue
    const base =
      style.speakerColors && segment.speaker !== undefined
        ? (style.speakerPalette[segment.speaker] ?? style.otherSpeakersColor)
        : style.color
    const words: Word[] = segment.words.length > 0 ? segment.words : [{ start: segment.start, end: segment.end, text: segment.text }]
    const inClip = words.filter((word) => word.end > clip.start && word.start < clip.end)

    for (let i = 0; i < inClip.length; i += WORDS_PER_LINE) {
      const line = inClip.slice(i, i + WORDS_PER_LINE)
      const lineEnd = Math.max(line[line.length - 1].end, line[0].start + 300)
      const text = (word: Word): string => clean(style.uppercase ? word.text.toUpperCase() : word.text)

      if (!style.highlight) {
        events.push(
          `Dialogue: 0,${assTime(line[0].start - clip.start)},${assTime(lineEnd - clip.start)},Default,,0,0,0,,${pos}{\\c${assColor(base)}}${line.map(text).join(' ')}`
        )
        continue
      }
      // One event per word: the whole line, with the current word in the highlight colour.
      line.forEach((word, j) => {
        const from = word.start
        const to = j < line.length - 1 ? line[j + 1].start : lineEnd
        const body = line
          .map((w, k) => (k === j ? `{\\c${assColor(style.highlightColor)}}${text(w)}{\\c${assColor(base)}}` : text(w)))
          .join(' ')
        events.push(
          `Dialogue: 0,${assTime(from - clip.start)},${assTime(Math.max(to, from + 50) - clip.start)},Default,,0,0,0,,${pos}{\\c${assColor(base)}}${body}`
        )
      })
    }
  }
  return header + events.join('\n') + '\n'
}

let encoderCache: string[] | null = null

/** Probes NVENC (FFmpeg can list encoders the hardware does not have) and falls back to x264. */
async function pickEncoder(ffmpeg: string): Promise<string[]> {
  if (encoderCache) return encoderCache
  try {
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'])
    encoderCache = ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '21', '-b:v', '0']
  } catch {
    encoderCache = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
  }
  return encoderCache
}

export async function renderClip(opts: {
  ffmpeg: string
  video: string
  clip: Clip
  segments: Segment[]
  style: SubtitleStyle
  layout: Layout
  workDir: string
  output: string
  signal: AbortSignal
  onProgress: (fraction: number) => void
}): Promise<void> {
  const { clip } = opts
  // Work in a folder with the .ass file and a copy of the fonts, so the subtitles filter
  // gets plain relative paths (Windows drive letters need awkward escaping in filters).
  const fontsDir = join(opts.workDir, 'fonts')
  if (!existsSync(fontsDir)) {
    mkdirSync(fontsDir, { recursive: true })
    for (const file of readdirSync(fontsSource()).filter((name) => /\.(ttf|otf)$/i.test(name))) {
      copyFileSync(join(fontsSource(), file), join(fontsDir, file))
    }
  }
  const assName = `clip-${clip.start}.ass`
  writeFileSync(join(opts.workDir, assName), buildAss(clip, opts.segments, opts.style))

  const subtitles = `subtitles=${assName}:fontsdir=fonts`
  const filter =
    opts.layout === 'focused'
      ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${subtitles}[v]`
      : // Blurred background: blur a small copy (fast), scale it up, overlay the full frame centred.
        `[0:v]split[a][b];[a]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10:2,scale=${W}:${H}[bg];` +
        `[b]scale=${W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${subtitles}[v]`

  const lengthMs = clip.end - clip.start
  await run(
    opts.ffmpeg,
    [
      '-y', '-v', 'error', '-progress', 'pipe:1',
      '-ss', String(clip.start / 1000), '-t', String(lengthMs / 1000), '-i', opts.video,
      '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
      ...(await pickEncoder(opts.ffmpeg)),
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
      opts.output
    ],
    {
      cwd: opts.workDir,
      signal: opts.signal,
      onStdout: (line) => {
        const match = line.match(/^out_time_us=(\d+)/)
        if (match) opts.onProgress(Math.min(1, Number(match[1]) / 1000 / lengthMs))
      }
    }
  )
}
