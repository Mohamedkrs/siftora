import { app } from 'electron'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { JobOptions } from '../shared/jobs'
import type { YoutubeInfo } from '../shared/types'
import { emitModelState } from './downloads'
import { log } from './logger'
import { getSettings } from './settings'
import { ffmpegPaths, run, type RunOptions } from './pipeline/run'

/** A web link for yt-dlp to try: YouTube, Facebook, TikTok, X, Instagram and many more sites. */
export function isVideoUrl(source: string): boolean {
  try {
    const url = new URL(source.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Only YouTube gets comments: other sites' extractors may have no cap on how many they fetch. */
export function isYoutubeUrl(source: string): boolean {
  try {
    return /(^|\.)youtube\.com$|^youtu\.be$/.test(new URL(source.trim()).hostname)
  } catch {
    return false
  }
}

const ASSET = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'

let installing: Promise<string> | null = null

function ytDlpFile(): string {
  return join(app.getPath('userData'), 'engines', 'yt-dlp', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
}

export function ytDlpInstalled(): boolean {
  return existsSync(ytDlpFile())
}

/**
 * yt-dlp is a single file; fetch the newest release, verified with GitHub's SHA-256 digest.
 * Also called at startup, so the first pasted link does not wait for the download.
 */
export async function ytDlpPath(): Promise<string> {
  const file = ytDlpFile()
  const dir = dirname(file)
  if (existsSync(file)) return file
  // Several links pasted at once must not download it in parallel.
  installing ??= installYtDlp(dir, file)
    .catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err)
      emitModelState({ id: YT_DLP_ID, status: 'error', error, receivedBytes: 0, bytesPerSec: 0, etaSec: null })
      throw err
    })
    .finally(() => (installing = null))
  return installing
}

async function installYtDlp(dir: string, file: string): Promise<string> {
  log.info('youtube', 'downloading yt-dlp')
  const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`Could not look up yt-dlp (HTTP ${response.status}).`)
  const release = (await response.json()) as {
    tag_name: string
    assets: { name: string; size: number; digest?: string; browser_download_url: string }[]
  }
  const asset = release.assets.find((a) => a.name === ASSET)
  if (!asset?.digest?.startsWith('sha256:')) throw new Error('No verified yt-dlp download for this system.')

  // No limit on the whole download (GitHub can be slow). A drop or 30 s without data is retried,
  // resuming where it stopped, before the link gives up.
  const chunks: Buffer[] = []
  for (let attempt = 1; ; attempt += 1) {
    try {
      await downloadPart(asset.browser_download_url, asset.size, chunks)
      break
    } catch (err) {
      if (attempt >= 10) throw err
      log.warn('youtube', `yt-dlp download interrupted (attempt ${attempt}), resuming: ${String(err)}`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  const data = Buffer.concat(chunks)
  if (createHash('sha256').update(data).digest('hex') !== asset.digest.slice(7)) {
    throw new Error('yt-dlp download was corrupted (checksum mismatch).')
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${file}.tmp`, data)
  renameSync(`${file}.tmp`, file)
  if (process.platform !== 'win32') chmodSync(file, 0o755)
  log.info('youtube', `installed yt-dlp ${release.tag_name}`)
  emitModelState({ id: YT_DLP_ID, status: 'installed', receivedBytes: data.length, totalBytes: data.length, bytesPerSec: 0, etaSec: null })
  return file
}

/** Download progress id, shown in Create and the sidebar like a model download. */
const YT_DLP_ID = 'yt-dlp'

/** Downloads the rest of the file into `chunks` (resuming after what they hold), reporting progress. */
async function downloadPart(url: string, totalBytes: number, chunks: Buffer[]): Promise<void> {
  const stalled = new AbortController()
  let idle = setTimeout(() => stalled.abort(), 30000)
  try {
    const have = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const response = await fetch(url, { signal: stalled.signal, headers: have > 0 ? { Range: `bytes=${have}-` } : {} })
    if (!response.ok || !response.body) throw new Error(`Could not download yt-dlp (HTTP ${response.status}).`)
    if (response.status !== 206) chunks.length = 0 // the server sent the whole file again
    let receivedBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const reader = response.body.getReader()
    const started = Date.now()
    const startBytes = receivedBytes
    let lastReport = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      clearTimeout(idle)
      idle = setTimeout(() => stalled.abort(), 30000)
      chunks.push(Buffer.from(value))
      receivedBytes += value.length
      const now = Date.now()
      if (now - lastReport < 250) continue
      lastReport = now
      const bytesPerSec = (receivedBytes - startBytes) / Math.max(0.001, (now - started) / 1000)
      const etaSec = totalBytes > receivedBytes && bytesPerSec > 0 ? Math.round((totalBytes - receivedBytes) / bytesPerSec) : null
      emitModelState({ id: YT_DLP_ID, status: 'downloading', receivedBytes, totalBytes, bytesPerSec, etaSec })
    }
    if (receivedBytes < totalBytes) throw new Error('connection closed early')
  } catch (err) {
    throw stalled.signal.aborted ? new Error('no data for 30 seconds') : err
  } finally {
    clearTimeout(idle)
  }
}

/** Facebook puts "916K views · 28K reactions | " in front of titles. */
function cleanTitle(title: string | undefined): string | undefined {
  const clean = title?.replace(/^\s*[\d.,]+\s*[KMB]?\s+(views|reactions|likes|plays)\b[^|]*\|\s*/i, '').trim()
  return clean || title
}

/** The user's cookies.txt, copied here: yt-dlp rewrites the file it is given, and the original may move. */
function cookiesFile(): string {
  return join(app.getPath('userData'), 'engines', 'yt-dlp', 'cookies.txt')
}

/** Keeps a copy of a Netscape-format cookies.txt that has YouTube cookies; returns why not otherwise. */
export function importCookies(path: string): string | null {
  if (statSync(path).size > 5 * 1024 * 1024) return 'That file is too big to be a cookies.txt.'
  const text = readFileSync(path, 'utf8')
  // "#HttpOnly_" lines are cookies too, not comments.
  const lines = text.split(/\r?\n/).filter((line) => line.trim() && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
  if (lines.length === 0 || lines.some((line) => line.split('\t').length !== 7)) {
    return 'That is not a cookies.txt file. Export one with a "cookies.txt" browser extension.'
  }
  if (!lines.some((line) => /^(#HttpOnly_)?\.?([\w-]+\.)*youtube\.com\t/.test(line))) {
    return 'That file has no YouTube sign-in. Open youtube.com while signed in, then export the cookies again.'
  }
  mkdirSync(dirname(cookiesFile()), { recursive: true })
  writeFileSync(cookiesFile(), text)
  log.info('youtube', 'loaded a cookies.txt for signed-in downloads')
  return null
}

/** Lets yt-dlp use the user's YouTube sign-in, when a browser or cookies file is chosen in Settings. */
function cookieArgs(): string[] {
  const source = getSettings().cookiesBrowser
  if (source === 'file') return existsSync(cookiesFile()) ? ['--cookies', cookiesFile()] : []
  return source ? ['--cookies-from-browser', source] : []
}

const NEEDS_SIGN_IN = /confirm your age|sign in to confirm|members-only|private video|login required|login details are needed/i

/**
 * Runs yt-dlp signed out first, and with the user's sign-in only when the site asks for one, so
 * public videos never depend on the sign-in (e.g. Brave being open locks its cookies).
 */
async function runYtDlp(ytDlp: string, args: string[], opts: RunOptions): Promise<{ stdout: string; stderr: string }> {
  // YouTube's "n challenge" needs a JavaScript runtime or only images are offered; the app's own
  // Electron runs as Node with ELECTRON_RUN_AS_NODE, so nothing extra is downloaded.
  args = ['--js-runtimes', `node:${process.execPath}`, ...args]
  opts = { ...opts, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
  try {
    return await run(ytDlp, args, opts)
  } catch (err) {
    const signIn = cookieArgs()
    if (signIn.length === 0 || !NEEDS_SIGN_IN.test(String(err))) throw explain(err)
    return await run(ytDlp, [...signIn, ...args], opts).catch((retryErr: unknown) => {
      throw explain(retryErr)
    })
  }
}

/** yt-dlp's errors for sign-in problems, said in a way the user can act on. */
function explain(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  const browser = getSettings().cookiesBrowser
  // Not just /cookie/: the age-gate error itself says "use --cookies-from-browser".
  if (/cookies? database|DPAPI|failed to decrypt/i.test(message) && browser && browser !== 'file') {
    return new Error(
      process.platform === 'win32'
        ? `Sign-in needed: could not read ${browser}'s sign-in; on Windows it is locked to ${browser}. Pick Firefox, or load a cookies.txt exported from ${browser}.`
        : `Sign-in needed: could not read ${browser}'s sign-in. Close ${browser} completely and check again, or pick Firefox.`
    )
  }
  if (NEEDS_SIGN_IN.test(message)) {
    return new Error(
      browser === 'file'
        ? 'Sign-in needed: the cookies.txt has no working YouTube sign-in (it may have expired). Export a new one from a private window you sign in to and close right after, then load it.'
        : browser
        ? `Sign-in needed: ${browser} is not signed in to YouTube with an account that may watch this video.`
        : 'Sign-in needed: this video is age-restricted or members-only.'
    )
  }
  return err instanceof Error ? err : new Error(message)
}

/** Title, length and available qualities of a link, without downloading the video. */
export async function youtubeInfo(url: string, signal?: AbortSignal): Promise<YoutubeInfo> {
  const ytDlp = await ytDlpPath()
  const output = await runYtDlp(ytDlp, ['--no-playlist', '-J', '--', url], { signal })
  const info = JSON.parse(output.stdout) as {
    title?: string
    duration?: number
    formats?: { height?: number | null; vcodec?: string }[]
  }
  const heights = (info.formats ?? []).flatMap((f) => (f.height && f.vcodec !== 'none' ? [f.height] : []))
  return {
    title: cleanTitle(info.title) ?? 'Online video',
    durationMs: Math.round((info.duration ?? 0) * 1000),
    heights: [...new Set(heights)].sort((a, b) => b - a)
  }
}

/** A YouTube channel page: /@name, /channel/…, /c/… or /user/…, optionally on a tab. */
export function isChannelUrl(source: string): boolean {
  try {
    const url = new URL(source.trim())
    return /(^|\.)youtube\.com$/.test(url.hostname) && /^\/(@[^/]+|(channel|c|user)\/[^/]+)(\/(videos|streams|shorts))?\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

/**
 * Links to a channel's `count` newest videos, newest first, without downloading them.
 * sinceDays > 0 keeps only those uploaded in that many days (YouTube's "3 days ago", so to the day).
 */
export async function channelVideos(url: string, count: number, sinceDays = 0, signal?: AbortSignal): Promise<string[]> {
  const page = new URL(url.trim())
  // A bare channel link lists its tabs, not videos.
  if (!/\/(videos|streams|shorts)\/?$/.test(page.pathname)) page.pathname = `${page.pathname.replace(/\/$/, '')}/videos`
  const ytDlp = await ytDlpPath()
  const dates = sinceDays > 0 ? ['--extractor-args', 'youtubetab:approximate_date'] : []
  const output = await runYtDlp(ytDlp, ['--flat-playlist', '-J', ...dates, '--playlist-end', String(count), '--', page.href], { signal })
  const info = JSON.parse(output.stdout) as { entries?: { id?: string; timestamp?: number }[] }
  const since = Date.now() / 1000 - sinceDays * 86_400
  return (info.entries ?? []).flatMap((entry) =>
    // No date (e.g. a live stream) counts as recent rather than silently dropping it.
    entry.id && (sinceDays <= 0 || entry.timestamp === undefined || entry.timestamp === null || entry.timestamp >= since)
      ? [`https://www.youtube.com/watch?v=${entry.id}`]
      : []
  )
}

/** A channel's name and its first few keywords (as tags), without listing its videos. */
export async function channelDetails(url: string, signal?: AbortSignal): Promise<{ name: string; tags: string[] }> {
  const output = await runYtDlp(await ytDlpPath(), ['--flat-playlist', '-J', '--playlist-items', '0', '--', url], { signal })
  const info = JSON.parse(output.stdout) as { channel?: string; uploader?: string; title?: string; tags?: unknown }
  const keywords = Array.isArray(info.tags) ? info.tags.filter((tag): tag is string => typeof tag === 'string') : []
  return {
    name: info.channel ?? info.uploader ?? info.title ?? '',
    tags: [...new Set(keywords.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 3)
  }
}

/** The channels the signed-in user subscribes to; needs the YouTube sign-in from Settings. */
export async function subscribedChannels(signal?: AbortSignal): Promise<{ url: string; name: string }[]> {
  const signIn = cookieArgs()
  if (signIn.length === 0) throw new Error('Sign-in needed: choose how Siftora signs in to YouTube in Settings first.')
  const ytDlp = await ytDlpPath()
  type Entry = { url?: string; title?: string; channel?: string; channel_url?: string; channel_id?: string }
  const list = async (page: string, extra: string[] = []): Promise<Entry[]> => {
    const output = await run(ytDlp, [...signIn, '--flat-playlist', '-J', ...extra, '--', page], { signal }).catch(
      (err: unknown) => {
        throw explain(err)
      }
    )
    return (JSON.parse(output.stdout) as { entries?: Entry[] } | null)?.entries ?? []
  }
  const channels = new Map<string, string>()
  for (const entry of await list('https://www.youtube.com/feed/channels').catch(() => [])) {
    const url = entry.url ?? entry.channel_url
    if (url && /youtube\.com\/(channel\/|@)/.test(url)) channels.set(url, entry.title ?? entry.channel ?? url)
  }
  // Fallback: the channels behind the newest videos in the subscriptions feed (misses quiet channels).
  if (channels.size === 0) {
    for (const entry of await list(':ytsubs', ['--playlist-end', '300'])) {
      const url = entry.channel_url ?? (entry.channel_id ? `https://www.youtube.com/channel/${entry.channel_id}` : undefined)
      if (url && !channels.has(url)) channels.set(url, entry.channel ?? url)
    }
  }
  return [...channels].map(([url, name]) => ({ url, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Downloads a video from a link (up to `maxHeight`p, 0 = best, mp4) into `dir`. */
export async function downloadYoutube(
  url: string,
  maxHeight: number,
  dir: string,
  signal: AbortSignal,
  onProgress: (progress: number, message?: string) => void,
  /** Known from the check on Create; saves asking the site again. */
  knownTitle?: string,
  comments?: JobOptions['comments']
): Promise<{ path: string; title: string }> {
  onProgress(0, 'Preparing the video downloader…')
  const ytDlp = await ytDlpPath()
  const { ffmpeg } = ffmpegPaths()

  const title = knownTitle ?? (await youtubeInfo(url, signal)).title

  await runYtDlp(
    ytDlp,
    [
      '--no-playlist',
      '--newline',
      '--ffmpeg-location', dirname(ffmpeg),
      '-f', maxHeight > 0 ? `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b` : 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--write-info-json', // video.info.json: has YouTube's "Most replayed" heatmap
      // Top-level comments only, into video.info.json.
      ...(comments
        ? ['--write-comments', '--extractor-args', `youtube:comment_sort=${comments.sort};max_comments=${comments.max},all,0`]
        : []),
      '-o', join(dir, 'video.%(ext)s'),
      url
    ],
    {
      signal,
      onStdout: (line) => {
        const match = line.match(/\[download\]\s+([\d.]+)%/)
        if (match) onProgress(Number(match[1]) / 100, title)
      }
    }
  )
  const file = readdirSync(dir).find((name) => /^video\.(mp4|mkv|webm)$/i.test(name))
  if (!file) throw new Error('The download did not produce a video file.')
  return { path: join(dir, file), title }
}
