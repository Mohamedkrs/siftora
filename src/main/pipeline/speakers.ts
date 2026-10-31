import { cpus } from 'node:os'
import { run } from './run'
import type { Segment } from './transcribe'

interface Turn {
  start: number
  end: number
  speaker: string
}

/** Runs sherpa-onnx speaker diarization; returns speaker turns in ms. */
export async function detectSpeakers(opts: {
  binary: string
  segmentationModel: string
  embeddingModel: string
  wav: string
  signal: AbortSignal
}): Promise<Turn[]> {
  const threads = String(Math.max(1, Math.min(8, cpus().length - 2)))
  const { stdout } = await run(
    opts.binary,
    [
      `--segmentation.pyannote-model=${opts.segmentationModel}`,
      `--embedding.model=${opts.embeddingModel}`,
      `--segmentation.num-threads=${threads}`,
      `--embedding.num-threads=${threads}`,
      // Higher = fewer speakers; 0.9 avoids splitting one voice into several.
      '--clustering.cluster-threshold=0.9',
      opts.wav
    ],
    { signal: opts.signal }
  )
  const turns: Turn[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*([\d.]+)\s+--\s+([\d.]+)\s+(\S+)/)
    if (match) turns.push({ start: Number(match[1]) * 1000, end: Number(match[2]) * 1000, speaker: match[3] })
  }
  return turns
}

/**
 * Gives each segment the speaker who overlaps it most. Speakers are ranked by total talk
 * time, so 0 = talks most (gets the first caption color). Returns the number of speakers.
 */
export function assignSpeakers(segments: Segment[], turns: Turn[]): number {
  const talk = new Map<string, number>()
  for (const turn of turns) talk.set(turn.speaker, (talk.get(turn.speaker) ?? 0) + turn.end - turn.start)
  const rank = new Map([...talk.entries()].sort((a, b) => b[1] - a[1]).map(([speaker], index) => [speaker, index]))

  for (const segment of segments) {
    let best: string | null = null
    let bestOverlap = 0
    for (const turn of turns) {
      const overlap = Math.min(turn.end, segment.end) - Math.max(turn.start, segment.start)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = turn.speaker
      }
    }
    if (best !== null) segment.speaker = rank.get(best)
  }
  return rank.size
}
