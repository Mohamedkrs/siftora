#!/usr/bin/env node
/**
 * How good are the found moments? Reads the app's feedback.jsonl and reports, per AI model and finder version:
 *   precision@K   share of the top K moments you kept (hearted, or rendered and not deleted)
 *   acceptance    kept / reviewed moments
 *   boundary      how far you moved the start and end when trimming
 *   duplicates    found moments overlapping another by more than half
 * Only videos you reviewed count (at least one heart, delete or render). Numbers are per video,
 * then averaged, so one long video cannot dominate.
 *
 *   node scripts/eval-clips.mjs [path/to/feedback.jsonl] [--k 3,5,10]
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const kFlag = args.indexOf('--k')
const KS = kFlag >= 0 ? args[kFlag + 1].split(',').map(Number) : [3, 5, 10]
const defaultPath =
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? '', 'Siftora', 'feedback.jsonl')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Siftora', 'feedback.jsonl')
      : join(homedir(), '.config', 'Siftora', 'feedback.jsonl')
const file = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--k') ?? defaultPath
if (!existsSync(file)) {
  console.error(`No feedback yet at ${file}. Heart, delete, trim or render some moments first.`)
  process.exit(1)
}

const events = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

/** One run of the finder on one video: the moments it found and what happened to each since. */
const runs = new Map()
const latestRun = new Map() // jobId -> run key; "Find moments again" starts a new run
for (const event of events) {
  if (event.action === 'found') {
    const key = `${event.jobId}@${event.at}`
    const finder = `${event.finder ?? 'unknown'} · finder v${event.finderVersion ?? 1}`
    if (!runs.has(key)) runs.set(key, { finder, clips: new Map() })
    latestRun.set(event.jobId, key)
    runs.get(key).clips.set(event.clipId, { ...event, fate: null, touched: false })
    continue
  }
  const run = runs.get(latestRun.get(event.jobId))
  const clip = run?.clips.get(event.clipId)
  if (!clip) continue // found before logging existed
  clip.touched = true
  if (event.action === 'delete') clip.fate = 'rejected'
  else if (event.action === 'heart' || event.action === 'render') clip.fate = clip.fate === 'rejected' ? 'rejected' : 'kept'
  else if (event.action === 'unheart' && !clip.rendered) clip.fate = null
  if (event.action === 'render') clip.rendered = true
  if (event.action === 'trim') {
    clip.finalStart = event.start
    clip.finalEnd = event.end
    clip.original = event.original
  }
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN)
const median = (values) => {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const pct = (value) => (Number.isNaN(value) ? '  n/a' : `${(value * 100).toFixed(0).padStart(4)}%`)
const secs = (ms) => (Number.isNaN(ms) ? 'n/a' : `${(ms / 1000).toFixed(1)}s`)

const byFinder = new Map()
for (const run of runs.values()) {
  const clips = [...run.clips.values()].sort((a, b) => a.rank - b.rank)
  if (!clips.some((clip) => clip.touched)) continue // not reviewed yet
  const stats = byFinder.get(run.finder) ?? { videos: 0, precision: Object.fromEntries(KS.map((k) => [k, []])), acceptance: [], startErr: [], endErr: [], dupes: [] }
  byFinder.set(run.finder, stats)
  stats.videos += 1
  // Untouched moments count as not kept: you saw them and did nothing.
  for (const k of KS) {
    const top = clips.slice(0, k)
    if (top.length === k) stats.precision[k].push(top.filter((clip) => clip.fate === 'kept').length / k)
  }
  const reviewed = clips.filter((clip) => clip.fate)
  if (reviewed.length) stats.acceptance.push(reviewed.filter((clip) => clip.fate === 'kept').length / reviewed.length)
  for (const clip of clips) {
    if (clip.original && clip.finalStart !== undefined) {
      stats.startErr.push(Math.abs(clip.finalStart - clip.original.start))
      stats.endErr.push(Math.abs(clip.finalEnd - clip.original.end))
    }
  }
  const dupes = clips.filter((a) =>
    clips.some(
      (b) => b !== a && Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.5 * Math.min(a.end - a.start, b.end - b.start)
    )
  )
  stats.dupes.push(dupes.length / clips.length)
}

if (byFinder.size === 0) {
  console.log('No reviewed videos yet. Heart the moments you like and delete the rest, then run this again.')
  process.exit(0)
}
for (const [finder, stats] of byFinder) {
  console.log(`\n${finder}  (${stats.videos} reviewed ${stats.videos === 1 ? 'video' : 'videos'})`)
  for (const k of KS) console.log(`  precision@${String(k).padEnd(3)} ${pct(mean(stats.precision[k]))}   (${stats.precision[k].length} videos with ${k}+ moments)`)
  console.log(`  acceptance     ${pct(mean(stats.acceptance))}`)
  console.log(`  start moved    median ${secs(median(stats.startErr))}, mean ${secs(mean(stats.startErr))}   (${stats.startErr.length} trims)`)
  console.log(`  end moved      median ${secs(median(stats.endErr))}, mean ${secs(mean(stats.endErr))}`)
  console.log(`  duplicates     ${pct(mean(stats.dupes))}`)
}
