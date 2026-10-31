import { app } from 'electron'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { log } from './logger'
import { ffmpegPaths, run } from './pipeline/run'

export function isYoutubeUrl(source: string): boolean {
  return /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(source.trim())
}

const ASSET = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'

/** yt-dlp is a single file; fetch the newest release, verified with GitHub's SHA-256 digest. */
async function ytDlpPath(): Promise<string> {
  const dir = join(app.getPath('userData'), 'engines', 'yt-dlp')
  const file = join(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  if (existsSync(file)) return file

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

/** Downloads a YouTube video (up to 1080p, mp4) into `dir`. */
export async function downloadYoutube(
  url: string,
  dir: string,
  signal: AbortSignal,
  onProgress: (progress: number, message?: string) => void
): Promise<{ path: string; title: string }> {
  onProgress(0, 'Preparing the YouTube downloader…')
  const ytDlp = await ytDlpPath()
  const { ffmpeg } = ffmpegPaths()

  const info = JSON.parse((await run(ytDlp, ['--no-playlist', '-J', url], { signal })).stdout) as { title?: string }
  const title = info.title ?? 'YouTube video'

  await run(
    ytDlp,
    [
      '--no-playlist',
      '--newline',
      '--ffmpeg-location', dirname(ffmpeg),
      '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
      '--merge-output-format', 'mp4',
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
  if (!file) throw new Error('The YouTube download did not produce a video file.')
  return { path: join(dir, file), title }
}
