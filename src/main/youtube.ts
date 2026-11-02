import { app } from 'electron'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { JobOptions } from '../shared/jobs'
import type { YoutubeInfo } from '../shared/types'
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

/** yt-dlp is a single file; fetch the newest release, verified with GitHub's SHA-256 digest. */
async function ytDlpPath(): Promise<string> {
  const dir = join(app.getPath('userData'), 'engines', 'yt-dlp')
  const file = join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (existsSync(file)) return file
  // Several links pasted at once must not download it in parallel.
  installing ??= installYtDlp(dir, file).finally(() => (installing = null))
  return installing
}

async function installYtDlp(dir: string, file: string): Promise<string> {

  const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`Could not look up yt-dlp (HTTP ${response.status}).`)
  const release = (await response.json()) as { tag_name: string; assets: { name: string; digest?: string; browser_download_url: string }[] }
  const asset = release.assets.find((a) => a.name === ASSET)
  if (!asset?.digest?.startsWith('sha256:')) throw new Error('No verified yt-dlp download for this system.')

  const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) })
  if (!download.ok) throw new Error(`Could not download yt-dlp (HTTP ${download.status}).`)
  const data = Buffer.from(await download.arrayBuffer())
  if (createHash('sha256').update(data).digest('hex') !== asset.digest.slice(7)) {
    throw new Error('yt-dlp download was corrupted (checksum mismatch).')
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${file}.tmp`, data)
  renameSync(`${file}.tmp`, file)
  if (process.platform !== 'win32') chmodSync(file, 0o755)
  log.info('youtube', `installed yt-dlp ${release.tag_name}`)
  return file
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

const NEEDS_SIGN_IN = /confirm your age|sign in to confirm|members-only|private video|login required/i

/**
 * Runs yt-dlp signed out first, and with the user's sign-in only when the site asks for one, so
 * public videos never depend on the sign-in (e.g. Brave being open locks its cookies).
 */
async function runYtDlp(ytDlp: string, args: string[], opts: RunOptions): Promise<{ stdout: string; stderr: string }> {
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
    return new Error(`Sign-in needed: could not read ${browser}'s sign-in. Close ${browser} completely and check again, or pick Firefox.`)
  }
  if (NEEDS_SIGN_IN.test(message)) {
    return new Error(
      browser === 'file'
        ? 'Sign-in needed: the cookies.txt has no working YouTube sign-in (it may have expired). Export a new one and load it.'
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
