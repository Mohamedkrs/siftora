import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 5 * 1024 * 1024

let logDir: string | null = null

function directory(): string {
  if (logDir) return logDir

  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logDir = dir
  return dir
}

function filePath(): string {
  return join(directory(), 'main.log')
}

export function initLogger(): void {
  try {
    const current = filePath()
    if (existsSync(current) && statSync(current).size > MAX_LOG_BYTES) {
      const old = join(directory(), 'main.old.log')
      rmSync(old, { force: true })
      renameSync(current, old)
    }
  } catch (err) {
    console.warn('[warn] [logger] could not rotate log file:', err)
  }
}

function write(level: 'info' | 'warn' | 'error', scope: string, msg: string): void {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${msg}`

  try {
    appendFileSync(filePath(), `${line}\n`)
  } catch {
    // Logging must never break the app.
  }

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (scope: string, msg: string): void => write('info', scope, msg),
  warn: (scope: string, msg: string): void => write('warn', scope, msg),
  error: (scope: string, msg: string): void => write('error', scope, msg)
}
