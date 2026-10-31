import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { SPEAKER_MODEL_IDS } from '../shared/catalog'
import { pickEngine } from '../shared/engines'
import type { Clip, Job, JobOptions } from '../shared/jobs'
import { IPC } from '../shared/types'
import { downloadModels, enginePath, listModels, modelFilePath } from './downloads'
import { log } from './logger'
import { findMoments, ollamaClient, startLlamaServer, type LlmClient } from './pipeline/discover'
import { renderClip } from './pipeline/render'
import { Cancelled, ffmpegPaths, run } from './pipeline/run'
import { assignSpeakers, detectSpeakers } from './pipeline/speakers'
import { fitWordsToSegments, transcribePython, transcribeWhisperCpp, type Transcript } from './pipeline/transcribe'
import { getSettings } from './settings'
import { downloadYoutube, isYoutubeUrl } from './youtube'

const jobs = new Map<string, Job>()
const controllers = new Map<string, AbortController>()
const renderQueue: { jobId: string; clipId: string }[] = []
let working = false
let rendering = false

const jobsRoot = (): string => join(app.getPath('userData'), 'jobs')
const jobDir = (id: string): string => join(jobsRoot(), id)

function save(job: Job): void {
  const dir = jobDir(job.id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'job.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(job, null, 1))
  renameSync(`${file}.tmp`, file)
}

function update(job: Job, patch: Partial<Job> = {}): void {
  Object.assign(job, patch)
  save(job)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.onJobUpdate, job)
  }
}

/** Progress updates are frequent; only broadcast/save a few per second. */
function progressUpdater(job: Job): (progress: number, message?: string) => void {
  let last = 0
  return (progress, message) => {
    const now = Date.now()
    if (now - last < 300 && progress < 1) return
    last = now
    update(job, { progress, ...(message ? { message } : {}) })
  }
}

export function loadJobs(): void {
  if (!existsSync(jobsRoot())) return
  for (const id of readdirSync(jobsRoot())) {
    try {
      const job = JSON.parse(readFileSync(join(jobDir(id), 'job.json'), 'utf8')) as Job
      // Interrupted by closing the app: finished stages are cached, so just queue it again.
      if (!['done', 'error', 'cancelled'].includes(job.stage)) job.stage = 'queued'
      for (const clip of job.clips) {
        if (clip.render.status === 'rendering' || clip.render.status === 'queued') clip.render = { status: 'idle', progress: 0 }
      }
      jobs.set(job.id, job)
    } catch {
      // Not a job folder or unreadable; ignore.
    }
  }
  void work()
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
}

function outputRoot(): string {
  return getSettings().outputDir || join(app.getPath('videos'), 'Viral Clip Finder')
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'
}

export function addJobs(sources: string[]): Job[] {
  const settings = getSettings()
  const options: JobOptions = {
    useVad: settings.useVad,
    speakers: settings.subtitle.speakerColors,
    subtitle: settings.subtitle,
    layout: settings.layout,
    language: settings.language,
    minClipSeconds: settings.minClipSeconds,
    maxClipSeconds: settings.maxClipSeconds,
    minScore: settings.minScore
  }
  const added = sources
    .filter((source) => source.trim().length > 0)
    .map((source): Job => {
      const url = isYoutubeUrl(source)
      const title = url ? source : basename(source, extname(source))
      const job: Job = {
        id: randomUUID(),
        source,
        videoPath: url ? null : source,
        title,
        createdAt: Date.now(),
        options,
        stage: 'queued',
        progress: 0,
        clips: [],
        outputDir: join(outputRoot(), safeName(title))
      }
      jobs.set(job.id, job)
      update(job)
      return job
    })
  void work()
  return added
}

export function cancelJob(id: string): void {
  const job = jobs.get(id)
  if (!job) return
  controllers.get(id)?.abort()
  if (job.stage === 'queued') update(job, { stage: 'cancelled', message: undefined })
}

export function removeJob(id: string): void {
  cancelJob(id)
  jobs.delete(id)
  rmSync(jobDir(id), { recursive: true, force: true })
}

export function retryJob(id: string): void {
  const job = jobs.get(id)
  if (!job || !['error', 'cancelled'].includes(job.stage)) return
  update(job, { stage: 'queued', progress: 0, error: undefined, message: undefined })
  void work()
}

/** "Find moments again": keep audio/transcript/speakers, redo discovery. */
export function findAgain(id: string): void {
  const job = jobs.get(id)
  if (!job || job.stage !== 'done') return
  rmSync(join(jobDir(id), 'clips.json'), { force: true })
  update(job, { stage: 'queued', progress: 0, clips: [], message: undefined })
  void work()
}

async function work(): Promise<void> {
  if (working) return
  working = true
  try {
    for (;;) {
      const next = listJobs().reverse().find((job) => job.stage === 'queued')
      if (!next) break
      const controller = new AbortController()
      controllers.set(next.id, controller)
      try {
        await runJob(next, controller.signal)
        update(next, { stage: 'done', progress: 1, message: `${next.clips.length} clips found` })
      } catch (err) {
        if (err instanceof Cancelled || controller.signal.aborted) {
          update(next, { stage: 'cancelled', message: undefined })
        } else {
          log.error('jobs', `${next.title}: ${String(err)}`)
          update(next, { stage: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        controllers.delete(next.id)
      }
    }
  } finally {
    working = false
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function runJob(job: Job, signal: AbortSignal): Promise<void> {
  const dir = jobDir(job.id)
  mkdirSync(dir, { recursive: true })
  const settings = getSettings()
  const { ffmpeg, ffprobe } = ffmpegPaths()

  // 1. YouTube download
  if (!job.videoPath || !existsSync(job.videoPath)) {
    if (!isYoutubeUrl(job.source)) throw new Error('The video file no longer exists.')
    update(job, { stage: 'download', progress: 0, message: undefined })
    const result = await downloadYoutube(job.source, dir, signal, progressUpdater(job))
    update(job, { videoPath: result.path, title: result.title, outputDir: join(outputRoot(), safeName(result.title)) })
  }
  const video = job.videoPath as string

  // 2. Audio (16 kHz mono, what every model wants)
  update(job, { stage: 'audio', progress: 0, message: undefined })
  if (!job.durationMs) {
    const probe = JSON.parse(
      (await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', video], { signal })).stdout
    ) as { format: { duration: string } }
    update(job, { durationMs: Math.round(Number(probe.format.duration) * 1000) })
  }
  const wav = join(dir, 'audio.wav')
  if (!existsSync(wav)) {
    await run(ffmpeg, ['-y', '-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', `${wav}.tmp.wav`], { signal })
    renameSync(`${wav}.tmp.wav`, wav)
  }

  // 3. Transcription (cached)
  const transcriptFile = join(dir, 'transcript.json')
  let transcript = readJson<Transcript>(transcriptFile)
  if (!transcript) {
    update(job, { stage: 'transcribe', progress: 0 })
    const onProgress = progressUpdater(job)
    if (settings.transcriptionProvider === 'openai-whisper' && settings.openaiWhisperPath) {
      transcript = await transcribePython({
        binary: settings.openaiWhisperPath,
        model: settings.openaiWhisperModel ?? 'turbo',
        wav,
        workDir: dir,
        language: job.options.language,
        signal,
        onProgress
      })
    } else {
      const binary = enginePath('whisper')
      const model = settings.transcriptionModel ? modelFilePath(settings.transcriptionModel) : null
      if (!binary) throw new Error('whisper.cpp is not installed. Install it from the Models screen.')
      if (!model) throw new Error('No transcription model selected. Choose one on the Models screen.')
      const vad = job.options.useVad ? modelFilePath('silero-vad') : null
      transcript = await transcribeWhisperCpp({
        binary,
        model,
        modelId: settings.transcriptionModel,
        vadModel: vad && existsSync(vad) ? vad : null,
        wav,
        workDir: dir,
        language: job.options.language,
        signal,
        onProgress
      })
    }
    writeFileSync(transcriptFile, JSON.stringify(transcript))
  }
  update(job, { language: transcript.language })

  // 4. Speakers (cached, optional)
  if (job.options.speakers) {
    const speakersFile = join(dir, 'speakers.json')
    const cached = readJson<{ count: number; speakers: (number | null)[] }>(speakersFile)
    if (cached) {
      transcript.segments.forEach((segment, i) => {
        if (cached.speakers[i] !== null) segment.speaker = cached.speakers[i] as number
      })
      update(job, { speakerCount: cached.count })
    } else {
      update(job, { stage: 'speakers', progress: 0, message: undefined })
      const binary = await speakerEngine(job, signal)
      update(job, { message: 'Listening for who speaks when — this takes a few minutes…' })
      const [segmentation, embedding] = SPEAKER_MODEL_IDS.map((id) => modelFilePath(id))
      if (!segmentation || !embedding || !existsSync(segmentation) || !existsSync(embedding)) {
        throw new Error('Speaker detection models are not downloaded. Get them on the Models screen.')
      }
      const turns = await detectSpeakers({ binary, segmentationModel: segmentation, embeddingModel: embedding, wav, signal })
      const count = assignSpeakers(transcript.segments, turns)
      writeFileSync(speakersFile, JSON.stringify({ count, speakers: transcript.segments.map((s) => s.speaker ?? null) }))
      update(job, { speakerCount: count })
    }
  }

  // 5. Moments
  update(job, { stage: 'find', progress: 0, message: 'Starting the AI model…' })
  let client: LlmClient
  if (settings.llmProvider === 'ollama' && settings.ollamaModel) {
    client = ollamaClient(settings.ollamaModel, signal)
  } else {
    const binary = enginePath('llama')
    const model = settings.llmModel ? modelFilePath(settings.llmModel) : null
    if (!binary) throw new Error('llama.cpp is not installed. Install it from the Models screen.')
    if (!model) throw new Error('No clip finder AI model selected. Choose one on the Models screen.')
    client = await startLlamaServer(binary, model, signal)
  }
  try {
    const onProgress = progressUpdater(job)
    const clips = await findMoments({
      client,
      segments: transcript.segments,
      durationMs: job.durationMs ?? 0,
      minClipSeconds: job.options.minClipSeconds,
      maxClipSeconds: job.options.maxClipSeconds,
      minScore: job.options.minScore,
      signal,
      onProgress: (fraction) => onProgress(fraction, 'Reading the transcript…')
    })
    writeFileSync(join(dir, 'clips.json'), JSON.stringify(clips))
    update(job, { clips })
  } finally {
    client.close()
  }
}

/** sherpa-onnx comes with the speaker detection feature; fetch it if it is missing. */
async function speakerEngine(job: Job, signal: AbortSignal): Promise<string> {
  const existing = enginePath('sherpa')
  if (existing) return existing
  const entry = pickEngine('sherpa', process.platform, process.arch, 'cpu')
  if (!entry) throw new Error('Speaker detection is not available on this system yet.')
  update(job, { message: 'Downloading the speaker detection engine…' })
  downloadModels([entry.id])
  for (;;) {
    if (signal.aborted) throw new Cancelled()
    const state = listModels().find((model) => model.id === entry.id)
    if (state?.status === 'installed') break
    if (state?.status === 'error' || state?.status === 'missing') {
      throw new Error(state.error ?? 'Could not download the speaker detection engine.')
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  const path = enginePath('sherpa')
  if (!path) throw new Error('Speaker detection engine was installed but not found.')
  return path
}

// ── Rendering ──

export function renderClips(jobId: string, clipIds: string[]): void {
  const job = jobs.get(jobId)
  if (!job) return
  for (const clip of job.clips) {
    if (!clipIds.includes(clip.id) || clip.render.status === 'queued' || clip.render.status === 'rendering') continue
    clip.render = { status: 'queued', progress: 0 }
    renderQueue.push({ jobId, clipId: clip.id })
  }
  update(job)
  void renderNext()
}

async function renderNext(): Promise<void> {
  if (rendering) return
  rendering = true
  try {
    for (let task = renderQueue.shift(); task; task = renderQueue.shift()) {
      const job = jobs.get(task.jobId)
      const clip = job?.clips.find((c) => c.id === task?.clipId)
      if (!job || !clip || !job.videoPath) continue
      await renderOne(job, clip)
    }
  } finally {
    rendering = false
  }
}

async function renderOne(job: Job, clip: Clip): Promise<void> {
  const controller = new AbortController()
  try {
    const { ffmpeg } = ffmpegPaths()
    const transcript = readJson<Transcript>(join(jobDir(job.id), 'transcript.json'))
    if (!transcript) throw new Error('Transcript missing; run the job again.')
    fitWordsToSegments(transcript.segments) // transcripts cached before this fix
    const speakers = readJson<{ speakers: (number | null)[] }>(join(jobDir(job.id), 'speakers.json'))
    if (speakers && job.options.speakers) {
      transcript.segments.forEach((segment, i) => {
        if (speakers.speakers[i] !== null) segment.speaker = speakers.speakers[i] as number
      })
    }
    mkdirSync(job.outputDir, { recursive: true })
    const rank = [...job.clips].sort((a, b) => b.score - a.score).indexOf(clip) + 1
    const output = join(job.outputDir, `${String(rank).padStart(2, '0')} - ${safeName(clip.title)}.mp4`)
    clip.render = { status: 'rendering', progress: 0 }
    update(job)
    let last = 0
    await renderClip({
      ffmpeg,
      video: job.videoPath as string,
      clip,
      segments: transcript.segments,
      // The style on Create now, not the one saved with the job, so restyling + "Render again" works.
      style: getSettings().subtitle,
      layout: getSettings().layout,
      workDir: join(jobDir(job.id), 'render'),
      output,
      signal: controller.signal,
      onProgress: (progress) => {
        if (Date.now() - last < 300) return
        last = Date.now()
        clip.render.progress = progress
        update(job)
      }
    })
    clip.render = { status: 'done', progress: 1, path: output }
  } catch (err) {
    log.error('render', `${job.title} / ${clip.title}: ${String(err)}`)
    clip.render = { status: 'error', progress: 0, error: err instanceof Error ? err.message : String(err) }
  }
  update(job)
}
