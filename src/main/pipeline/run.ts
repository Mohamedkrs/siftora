import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { enginePath } from '../downloads'

export class Cancelled extends Error {
  constructor() {
    super('Cancelled')
  }
}

interface RunOptions {
  cwd?: string
  signal?: AbortSignal
  /** Called for every line on stderr (progress output). */
  onStderr?: (line: string) => void
  onStdout?: (line: string) => void
}

/** Runs a program (argument array, no shell) and resolves with its output; rejects on failure. */
export function run(file: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Cancelled())
    const child = spawn(file, args, { cwd: opts.cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const lines = (onLine?: (line: string) => void) => {
      let buffer = ''
      return (chunk: Buffer): string => {
        const text = chunk.toString()
        if (onLine) {
          buffer += text
          const parts = buffer.split(/\r?\n|\r/)
          buffer = parts.pop() ?? ''
          parts.forEach(onLine)
        }
        return text
      }
    }
    const out = lines(opts.onStdout)
    const err = lines(opts.onStderr)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += out(chunk)
      if (stdout.length > 20_000_000) stdout = stdout.slice(-10_000_000)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + err(chunk)).slice(-20_000)
    })
    const abort = (): void => {
      child.kill()
    }
    opts.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      opts.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', abort)
      if (opts.signal?.aborted) return reject(new Cancelled())
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${file.split(/[\\/]/).pop()} exited with code ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`))
    })
  })
}

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = enginePath('ffmpeg')
  if (!ffmpeg) throw new Error('FFmpeg is not installed. Install it from the Models screen.')
  const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  if (!existsSync(ffprobe)) throw new Error('ffprobe was not found next to FFmpeg.')
  return { ffmpeg, ffprobe }
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
