import { app, BrowserWindow, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { CATALOG, REACTION_MODEL_IDS, llamaTooOld, SPEAKER_MODEL_IDS } from '../shared/catalog'
import { pickEngine } from '../shared/engines'
import type { Clip, Job, JobOptions } from '../shared/jobs'
import { IPC, type YoutubeChoice } from '../shared/types'
import { downloadModels, enginePath, listModels, modelFilePath } from './downloads'
import { readGgufInfo } from './gguf'
import { log } from './logger'
import { findMoments, ollamaClient, startLlamaServer, writePosts, type LlmClient } from './pipeline/discover'
import { detectReactions, type ReactionLevels } from './pipeline/reactions'
import { renderClip } from './pipeline/render'
import { Cancelled, ffmpegPaths, run } from './pipeline/run'
import { assignSpeakers, detectSpeakers } from './pipeline/speakers'
import { DEFAULT_YOUTUBE_HEIGHT, rangeKey, renderStyleKey } from '../shared/jobs'
import { fitWordsToSegments, transcribePython, transcribeWhisperCpp, type Transcript } from './pipeline/transcribe'
import { getSettings } from './settings'
import { ownLlamaBuild } from './systemEngines'
import { downloadYoutube, isVideoUrl } from './youtube'

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

/** True while a video is being processed or a reel rendered. */
export function isBusy(): boolean {
  return working || rendering
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
}

function outputRoot(): string {
  return getSettings().outputDir || join(app.getPath('videos'), 'Siftora')
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'
}

export function addJobs(sources: string[], links: Record<string, YoutubeChoice> = {}): Job[] {
  const settings = getSettings()
  const options: JobOptions = {
    useVad: settings.useVad,
    speakers: settings.detectSpeakers,
    speakersWhen: settings.speakersWhen,
    reactions: settings.detectReactions,
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
      const url = isVideoUrl(source)
      const link = Object.hasOwn(links, source) ? links[source] : undefined
      const title = link?.title ?? (url ? source : basename(source, extname(source)))
      const job: Job = {
        id: randomUUID(),
        source,
        videoPath: url ? null : source,
        title,
        createdAt: Date.now(),
        options: link ? { ...options, youtubeMaxHeight: link.height } : options,
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

/** Takes a video off the Queue. A finished one keeps its results on Results; others are deleted. */
export function removeJob(id: string): void {
  const job = jobs.get(id)
  if (job?.stage === 'done') update(job, { hiddenFromQueue: true })
  else forgetJob(id)
}

function forgetJob(id: string): void {
  cancelJob(id)
  jobs.delete(id)
  rmSync(jobDir(id), { recursive: true, force: true })
}

/** True for a path inside `folder` (case-insensitive on Windows). */
function isInside(path: string, folder: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
  return norm(path).startsWith(norm(folder) + sep)
}

/**
 * Deletes everything a video produced: its rendered reels go to the Recycle Bin / Trash, then its
 * saved data (audio, transcript, a YouTube download) is removed. The original video file is
 * never touched.
 */
export async function deleteJob(id: string): Promise<void> {
  const job = jobs.get(id)
  if (!job) return
  for (const clip of job.clips) {
    const path = clip.render.path
    // Only reels the app rendered into this video's output folder.
    if (clip.render.status === 'done' && path && existsSync(path) && isInside(path, job.outputDir)) {
      await shell.trashItem(path)
    }
  }
  try {
    if (readdirSync(job.outputDir).length === 0) rmdirSync(job.outputDir)
  } catch {
    // Folder already gone, or the user keeps other files there.
  }
  forgetJob(id)
}

export function retryJob(id: string): void {
  const job = jobs.get(id)
  if (!job || !['error', 'cancelled'].includes(job.stage)) return
  update(job, { stage: 'queued', progress: 0, error: undefined, message: undefined })
  void work()
}

/** "Find moments again": keep audio/transcript/speakers, redo discovery. */
/** Rewrites the titles, captions and descriptions of a video's clips; the clips themselves stay. */
export function rewritePosts(id: string): void {
  const job = jobs.get(id)
  if (!job || job.stage !== 'done' || job.clips.length === 0) return
  if (job.clips.some((clip) => clip.render.status === 'queued' || clip.render.status === 'rendering')) return
  update(job, { stage: 'queued', progress: 0, message: undefined, rewritePosts: true, hiddenFromQueue: undefined })
  void work()
}

export function findAgain(id: string): void {
  const job = jobs.get(id)
  if (!job || job.stage !== 'done') return
  rmSync(join(jobDir(id), 'clips.json'), { force: true })
  update(job, { stage: 'queued', progress: 0, clips: [], message: undefined, hiddenFromQueue: undefined })
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

  // 1. Download (links)
  if (!job.videoPath || !existsSync(job.videoPath)) {
    if (!isVideoUrl(job.source)) throw new Error('The video file no longer exists.')
    update(job, { stage: 'download', progress: 0, message: undefined })
    const result = await downloadYoutube(
      job.source,
      job.options.youtubeMaxHeight ?? DEFAULT_YOUTUBE_HEIGHT,
      dir,
      signal,
      progressUpdater(job),
      job.title !== job.source ? job.title : undefined
    )
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
    // Speaker caches index into the old transcript's segments.
    rmSync(join(dir, 'speakers.json'), { force: true })
    rmSync(join(dir, 'speakers'), { recursive: true, force: true })
  }
  update(job, { language: transcript.language })

  // 4. Speakers (cached, optional; in 'clip' mode they are found per clip at render)
  if (job.options.speakers && job.options.speakersWhen !== 'clip') {
    const speakersFile = join(dir, 'speakers.json')
    const cached = readJson<{ count: number; speakers: (number | null)[] }>(speakersFile)
    if (cached) {
      transcript.segments.forEach((segment, i) => {
        if (cached.speakers[i] !== null) segment.speaker = cached.speakers[i] as number
      })
      update(job, { speakerCount: cached.count })
    } else {
      update(job, { stage: 'speakers', progress: 0, message: undefined })
      const turns = await speakerTurns(
        wav,
        signal,
        (message) => update(job, { message }),
        'Listening for who speaks when — this takes a few minutes…'
      )
      const count = assignSpeakers(transcript.segments, turns)
      writeFileSync(speakersFile, JSON.stringify({ count, speakers: transcript.segments.map((s) => s.speaker ?? null) }))
      update(job, { speakerCount: count })
    }
  }

  // 5. Reactions (cached, optional; depends only on the audio)
  let reactions: ReactionLevels | undefined
  if (job.options.reactions) {
    const reactionsFile = join(dir, 'reactions.json')
    reactions = readJson<ReactionLevels>(reactionsFile) ?? undefined
    if (!reactions) {
      update(job, { stage: 'reactions', progress: 0, message: undefined })
      const engine = await sherpaEngine(signal, (message) => update(job, { message }))
      // Same sherpa-onnx package as speaker detection, a different program in it.
      const binary = join(dirname(engine), `sherpa-onnx-offline-audio-tagging${process.platform === 'win32' ? '.exe' : ''}`)
      if (!existsSync(binary)) throw new Error('This sherpa-onnx build has no audio tagging program.')
      const [model, labels] = REACTION_MODEL_IDS.map((id) => modelFilePath(id))
      if (!model || !labels || !existsSync(model) || !existsSync(labels)) {
        throw new Error('Reaction detection models are not downloaded. Get them on the Models screen.')
      }
      update(job, { message: undefined })
      const onProgress = progressUpdater(job)
      reactions = await detectReactions({
        ffmpeg,
        binary,
        model,
        labels,
        wav,
        workDir: dir,
        signal,
        onProgress: (fraction) => onProgress(fraction)
      })
      writeFileSync(reactionsFile, JSON.stringify(reactions))
    }
  }

  // 6. Moments
  update(job, { stage: 'find', progress: 0, message: 'Starting the AI model…' })
  let client: LlmClient
  if (settings.llmProvider === 'ollama' && settings.ollamaModel) {
    client = ollamaClient(settings.ollamaModel, signal)
  } else {
    const binary = enginePath('llama')
    const model = settings.llmModel ? modelFilePath(settings.llmModel) : null
    if (!binary) throw new Error('llama.cpp is not installed. Install it from the Models screen.')
    if (!model) throw new Error('No clip finder AI model selected. Choose one on the Models screen.')
    const tooOld = llamaTooOld(modelArchitecture(settings.llmModel as string, model), await ownLlamaBuild())
    if (tooOld) throw new Error(tooOld)
    client = await startLlamaServer(binary, model, signal)
  }
  try {
    const onProgress = progressUpdater(job)
    const rewriteOnly = job.rewritePosts === true && job.clips.length > 0
    const clips = rewriteOnly ? job.clips : await findMoments({
      client,
      segments: transcript.segments,
      durationMs: job.durationMs ?? 0,
      minClipSeconds: job.options.minClipSeconds,
      maxClipSeconds: job.options.maxClipSeconds,
      minScore: job.options.minScore,
      replay: readJson<{ heatmap?: { start_time: number; end_time: number; value: number }[] }>(
        join(dir, 'video.info.json')
      )?.heatmap?.map((p) => ({ start: p.start_time * 1000, end: p.end_time * 1000, value: p.value })),
      reactions,
      signal,
      onProgress: (fraction) => onProgress(fraction, 'Reading the transcript…')
    })
    await writePosts({
      client,
      clips,
      segments: transcript.segments,
      videoContext: videoContext(job.title, dir),
      signal,
      onProgress: (fraction) => onProgress(fraction, 'Writing titles and captions…')
    })
    writeFileSync(join(dir, 'clips.json'), JSON.stringify(clips))
    update(job, { clips, rewritePosts: undefined })
  } finally {
    client.close()
  }
}

/** What the writing step should know about the long video: title, plus channel, description and tags for links. */
function videoContext(title: string, dir: string): string {
  const info = readJson<{ channel?: string; uploader?: string; description?: string; tags?: string[] }>(
    join(dir, 'video.info.json')
  )
  const channel = info?.channel ?? info?.uploader
  // Social and merch links say nothing about the video; @handles and plain text do.
  const description = (info?.description ?? '')
    .split('\n')
    .filter((line) => line.trim() && !/https?:\/\//.test(line))
    .join(' ')
    .slice(0, 500)
  return [
    `Video title: ${title}`,
    channel ? `Channel: ${channel}` : null,
    description ? `Video description: ${description}` : null,
    info?.tags?.length ? `Video tags: ${info.tags.slice(0, 15).join(', ')}` : null
  ]
    .filter(Boolean)
    .join('\n')
}

async function speakerTurns(
  wav: string,
  signal: AbortSignal,
  onMessage: (message: string) => void,
  working = 'Finding who speaks…'
): ReturnType<typeof detectSpeakers> {
  const binary = await sherpaEngine(signal, onMessage)
  onMessage(working)
  const [segmentation, embedding] = SPEAKER_MODEL_IDS.map((id) => modelFilePath(id))
  if (!segmentation || !embedding || !existsSync(segmentation) || !existsSync(embedding)) {
    throw new Error('Speaker detection models are not downloaded. Get them on the Models screen.')
  }
  return detectSpeakers({ binary, segmentationModel: segmentation, embeddingModel: embedding, wav, signal })
}

/** Speakers for one clip only: diarize its slice of audio.wav, cached per clip start/end. */
async function clipSpeakers(
  job: Job,
  clip: Clip,
  segments: Transcript['segments'],
  signal: AbortSignal,
  onMessage: (message: string) => void
): Promise<void> {
  const dir = join(jobDir(job.id), 'speakers')
  const file = join(dir, `${clip.id}-${clip.start}-${clip.end}.json`)
  const inClip = segments.filter((s) => s.end > clip.start && s.start < clip.end)
  const cached = readJson<(number | null)[]>(file)
  if (cached) {
    inClip.forEach((segment, i) => {
      if (cached[i] !== null) segment.speaker = cached[i] as number
    })
    return
  }
  mkdirSync(dir, { recursive: true })
  const slice = join(dir, `${clip.id}.wav`)
  const { ffmpeg } = ffmpegPaths()
  const args = ['-y', '-v', 'error', '-ss', String(clip.start / 1000), '-t', String((clip.end - clip.start) / 1000)]
  await run(ffmpeg, [...args, '-i', join(jobDir(job.id), 'audio.wav'), '-c:a', 'pcm_s16le', slice], { signal })
  try {
    const turns = (await speakerTurns(slice, signal, onMessage)).map((t) => ({ ...t, start: t.start + clip.start, end: t.end + clip.start }))
    assignSpeakers(inClip, turns)
  } finally {
    rmSync(slice, { force: true })
  }
  writeFileSync(file, JSON.stringify(inClip.map((s) => s.speaker ?? null)))
}

function modelArchitecture(id: string, path: string): string | undefined {
  const known = CATALOG.find((entry) => entry.id === id)?.gguf?.architecture
  if (known) return known
  try {
    return readGgufInfo(path).architecture
  } catch {
    return undefined // unreadable: llama-server will say what is wrong
  }
}

/** sherpa-onnx runs speaker and reaction detection; fetch it if it is missing. */
async function sherpaEngine(signal: AbortSignal, onMessage: (message: string) => void): Promise<string> {
  const existing = enginePath('sherpa')
  if (existing) return existing
  const entry = pickEngine('sherpa', process.platform, process.arch, 'cpu')
  if (!entry) throw new Error('Speaker and reaction detection are not available on this system yet.')
  onMessage('Downloading the audio analysis engine (sherpa-onnx)…')
  downloadModels([entry.id])
  for (;;) {
    if (signal.aborted) throw new Cancelled()
    const state = listModels().find((model) => model.id === entry.id)
    if (state?.status === 'installed') break
    if (state?.status === 'error' || state?.status === 'missing') {
      throw new Error(state.error ?? 'Could not download the audio analysis engine (sherpa-onnx).')
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  const path = enginePath('sherpa')
  if (!path) throw new Error('The audio analysis engine (sherpa-onnx) was installed but not found.')
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

/** Moves a rendered reel to the Recycle Bin / Trash; the clip stays and can be rendered again. */
export async function deleteReel(jobId: string, clipId: string): Promise<void> {
  const job = jobs.get(jobId)
  const clip = job?.clips.find((c) => c.id === clipId)
  if (!job || !clip || clip.render.status !== 'done') return
  const path = clip.render.path
  // Only ever a file the app rendered into this video's output folder.
  if (path && existsSync(path) && isInside(path, job.outputDir)) await shell.trashItem(path)
  clip.render = { status: 'idle', progress: 0 }
  update(job)
}

/** Shortest clip a user can trim to. */
const MIN_CLIP_MS = 1000

/**
 * Sets a clip's start/end by hand (ms in the source video). The clip keeps its id; a reel
 * rendered before shows as out of date until it is rendered again.
 */
export function setClipRange(jobId: string, clipId: string, start: number, end: number): void {
  const job = jobs.get(jobId)
  const clip = job?.clips.find((c) => c.id === clipId)
  if (!job || !clip || clip.render.status === 'queued' || clip.render.status === 'rendering') return
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  const from = Math.max(0, Math.round(start))
  const to = Math.min(job.durationMs ?? Infinity, Math.round(end))
  if (to - from < MIN_CLIP_MS) return

  clip.original ??= { start: clip.start, end: clip.end }
  clip.start = from
  clip.end = to
  const atOriginal = clip.start === clip.original.start && clip.end === clip.original.end
  if (atOriginal) clip.original = undefined
  clip.notes = clip.notes.filter((note) => note !== 'length set by hand')
  if (!atOriginal) clip.notes.push('length set by hand')
  const words = readJson<Transcript>(join(jobDir(job.id), 'transcript.json'))?.segments.flatMap((s) => s.words ?? []) ?? []
  const spoken = words.filter((word) => word.start >= from && word.end <= to)
  if (spoken.length > 0) clip.text = spoken.map((word) => word.text.trim()).join(' ')
  update(job)
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
    if (speakers && job.options.speakers && job.options.speakersWhen !== 'clip') {
      transcript.segments.forEach((segment, i) => {
        if (speakers.speakers[i] !== null) segment.speaker = speakers.speakers[i] as number
      })
    }
    mkdirSync(job.outputDir, { recursive: true })
    const rank = [...job.clips].sort((a, b) => b.score - a.score).indexOf(clip) + 1
    const output = join(job.outputDir, `${String(rank).padStart(2, '0')} - ${safeName(clip.title)}.mp4`)
    // The style on Results now, not the one saved with the job, so restyling + "Render again" works.
    const { subtitle: style, layout } = getSettings()
    const onMessage = (message: string): void => {
      clip.render.message = message
      update(job)
    }
    clip.render = { status: 'rendering', progress: 0 }
    update(job)
    if (job.options.speakers && job.options.speakersWhen === 'clip' && style.speakerColors) {
      onMessage('Finding who speaks…')
      await clipSpeakers(job, clip, transcript.segments, controller.signal, onMessage)
      clip.render.message = undefined
    }
    let last = 0
    await renderClip({
      ffmpeg,
      video: job.videoPath as string,
      clip,
      segments: transcript.segments,
      style,
      layout,
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
    clip.render = {
      status: 'done',
      progress: 1,
      path: output,
      style: renderStyleKey(style, layout),
      range: rangeKey(clip),
      at: Date.now()
    }
  } catch (err) {
    log.error('render', `${job.title} / ${clip.title}: ${String(err)}`)
    clip.render = { status: 'error', progress: 0, error: err instanceof Error ? err.message : String(err) }
  }
  update(job)
}
