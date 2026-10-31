// Smoke test for a whisper.cpp build, run by .github/workflows/engines.yml before a build is
// published. It runs whisper-cli with the same flags the app uses (src/main/pipeline/transcribe.ts)
// on JFK's speech twice with 8 s of silence between, and checks the JSON the app depends on.
//
// usage: node smoke-whisper.mjs <whisper-cli> <ggml-base.bin> <ggml-silero.bin> <jfk.wav> <work dir>

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [binary, model, vadModel, jfk, work] = process.argv.slice(2)
if (!work) {
  console.error('usage: node smoke-whisper.mjs <whisper-cli> <model> <vad model> <jfk.wav> <work dir>')
  process.exit(2)
}
mkdirSync(work, { recursive: true })

const SILENCE_SEC = 8
const failures = []
const check = (ok, message) => {
  if (!ok) failures.push(message)
}

// jfk.wav is 16 kHz mono 16-bit PCM; build speech + silence + speech.
const wav = readFileSync(jfk)
const dataAt = wav.indexOf('data') // byte offset of the "data" chunk id
const pcm = wav.subarray(dataAt + 8, dataAt + 8 + wav.readUInt32LE(dataAt + 4))
const speechMs = (pcm.length / 2 / 16000) * 1000
const body = Buffer.concat([pcm, Buffer.alloc(SILENCE_SEC * 16000 * 2), pcm])
const header = Buffer.from(wav.subarray(0, dataAt + 8))
header.writeUInt32LE(36 + body.length, 4)
header.writeUInt32LE(body.length, dataAt + 4)
const input = join(work, 'test.wav')
writeFileSync(input, Buffer.concat([header, body]))

const base = join(work, 'out')
const args = ['-m', model, '-f', input, '-l', 'en', '-ojf', '-of', base, '-pp', '-sns', '-dtw', 'base', '--vad', '-vm', vadModel]
console.log(`$ ${binary} ${args.join(' ')}`)
const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.status !== 0) {
  console.error(`whisper-cli exited with ${result.status ?? result.error}`)
  process.exit(1)
}

// The app maps word times with the speech spans whisper.cpp logs (vadToOriginal in transcribe.ts).
const spans = [...(result.stderr ?? '').matchAll(/vad_segment_info: orig_start: ([\d.]+), orig_end: ([\d.]+), vad_start: ([\d.]+), vad_end: ([\d.]+)/g)]
  .map((m) => m.slice(1).map((v) => Math.round(Number(v) * 1000)))
  .map(([orig, origEnd, vad, vadEnd]) => ({ orig, origEnd, vad, vadEnd }))
check(spans.length >= 2, 'whisper-cli no longer logs "vad_segment_info" lines (the app needs them for word timings)')
function vadToOriginal(ms, edge) {
  if (spans.length === 0) return ms
  if (ms <= spans[0].vad) return spans[0].orig - (spans[0].vad - ms)
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i]
    if (ms <= span.vadEnd) return span.orig + (ms - span.vad)
    const next = spans[i + 1]
    if (next && ms < next.vad) return edge === 'end' ? span.origEnd + (ms - span.vadEnd) : next.orig - (next.vad - ms)
  }
  const last = spans[spans.length - 1]
  return last.origEnd + (ms - last.vadEnd)
}

const raw = JSON.parse(readFileSync(`${base}.json`, 'utf8'))
const segments = raw.transcription
check(Array.isArray(segments) && segments.length >= 2, 'expected at least 2 segments')

// Same shape checks and word building as the app (tokensToWords + vadToOriginal).
let words = []
for (const segment of segments ?? []) {
  check(typeof segment.offsets?.from === 'number' && typeof segment.offsets?.to === 'number', 'segment without offsets')
  check(Array.isArray(segment.tokens), 'segment without tokens (needed for word timings)')
  const segWords = []
  for (const token of segment.tokens ?? []) {
    if (!token.text || token.text.startsWith('[_')) continue
    check(typeof token.offsets?.from === 'number', 'token without offsets')
    const start = token.t_dtw && token.t_dtw > 0 ? token.t_dtw * 10 : token.offsets.from
    if (token.text.startsWith(' ') || segWords.length === 0) segWords.push({ start, end: token.offsets.to, text: token.text.trim() })
    else {
      segWords[segWords.length - 1].text += token.text
      if (/[\p{L}\p{N}]/u.test(token.text)) segWords[segWords.length - 1].end = token.offsets.to
    }
  }
  const real = segWords.filter((word) => word.text.length > 0)
  words = words.concat(real.map((word) => ({ ...word, start: vadToOriginal(word.start, 'start'), end: vadToOriginal(word.end, 'end'), segment })))
}

const text = (segments ?? []).map((segment) => segment.text).join(' ').toLowerCase().replace(/[^a-z ]/g, '')
const said = text.split('ask not what your country can do for you').length - 1
check(said === 2, `expected the JFK line twice, found it ${said} time(s): "${text}"`)
check(words.length >= 40, `expected at least 40 words, got ${words.length}`)

// The second "country" must be placed after the silence, on the real timeline.
const countries = words.filter((word) => /country/i.test(word.text))
const second = countries[countries.length - 1]
check(second && second.start > speechMs + (SILENCE_SEC - 1) * 1000, `second "country" at ${second?.start} ms, expected after ${speechMs + SILENCE_SEC * 1000} ms`)
check(
  words.every((word) => word.start >= word.segment.offsets.from - 300 && word.end <= word.segment.offsets.to + 300),
  'word timings fall outside their segment'
)
// No word may sit inside the silence.
check(
  words.every((word) => word.end <= speechMs + 300 || word.start >= speechMs + SILENCE_SEC * 1000 - 300),
  'a word was placed inside the silence'
)

if (failures.length > 0) {
  console.error(`\nSMOKE TEST FAILED:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(`\nSmoke test passed: ${segments.length} segments, ${words.length} words, language ${raw.result?.language}.`)
