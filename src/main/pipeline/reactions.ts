import { cpus } from 'node:os'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Cancelled, run } from './run'

/** Reactions are measured per slice of this length. */
export const SLICE_MS = 4000

/** Audience and speaker reactions, each made of AudioSet labels the tagger reports. */
export const REACTIONS = {
  laughter: ['Laughter', 'Giggle', 'Snicker', 'Belly laugh', 'Chuckle, chortle'],
  cheering: ['Cheering', 'Applause', 'Clapping', 'Whoop'],
  shouting: ['Shout', 'Bellow', 'Yell', 'Screaming', 'Battle cry'],
  crying: ['Crying, sobbing', 'Whimper', 'Wail, moan'],
  gasp: ['Gasp']
} as const
// Not used: Groan / Sigh. In a comedy test they fired on deliberate silly noises, not letdowns.

export type Reaction = keyof typeof REACTIONS

/** Per reaction, its probability (0-1) in each SLICE_MS of the audio. */
export type ReactionLevels = Record<Reaction, number[]>

const REACTION_OF = new Map<string, Reaction>(
  (Object.entries(REACTIONS) as [Reaction, readonly string[]][]).flatMap(([reaction, labels]) =>
    labels.map((label) => [label, reaction] as [string, Reaction])
  )
)

/**
 * Hears reactions with sherpa-onnx audio tagging (CED). The tagger takes one file per run,
 * so the audio is sliced and runs go in parallel.
 */
export async function detectReactions(opts: {
  ffmpeg: string
  binary: string
  model: string
  labels: string
  wav: string
  workDir: string
  signal: AbortSignal
  onProgress: (fraction: number) => void
}): Promise<ReactionLevels> {
  const dir = join(opts.workDir, 'reaction-slices')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const segment = ['-f', 'segment', '-segment_time', String(SLICE_MS / 1000), '-c:a', 'pcm_s16le']
    await run(opts.ffmpeg, ['-y', '-v', 'error', '-i', opts.wav, ...segment, join(dir, '%06d.wav')], { signal: opts.signal })
    const slices = readdirSync(dir).filter((name) => name.endsWith('.wav')).sort()

    const levels = Object.fromEntries(
      Object.keys(REACTIONS).map((reaction) => [reaction, new Array<number>(slices.length).fill(0)])
    ) as ReactionLevels
    let next = 0
    let done = 0
    const worker = async (): Promise<void> => {
      for (let i = next++; i < slices.length; i = next++) {
        if (opts.signal.aborted) throw new Cancelled()
        const { stdout } = await run(
          opts.binary,
          [
            '--print-args=false',
            `--ced-model=${opts.model}`,
            `--labels=${opts.labels}`,
            '--top-k=527', // every label, so a reaction is reported even when speech dominates
            join(dir, slices[i])
          ],
          { signal: opts.signal }
        )
        for (const [reaction, level] of Object.entries(reactionsIn(stdout)) as [Reaction, number][]) {
          levels[reaction][i] = level
        }
        opts.onProgress(++done / slices.length)
      }
    }
    const parallel = Math.max(1, Math.min(6, cpus().length - 2))
    await Promise.all(Array.from({ length: parallel }, worker))
    return levels
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Highest probability per reaction in one tagger output. */
export function reactionsIn(stdout: string): Partial<Record<Reaction, number>> {
  const best: Partial<Record<Reaction, number>> = {}
  for (const match of stdout.matchAll(/AudioEvent\(name="([^"]+)", index=\d+, prob=([\d.eE+-]+)\)/g)) {
    const reaction = REACTION_OF.get(match[1])
    if (reaction) best[reaction] = Math.max(best[reaction] ?? 0, Number(match[2]) || 0)
  }
  return best
}
