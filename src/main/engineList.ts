import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyEngineList,
  ENGINE_LIST_URL,
  ENGINE_REPO,
  type EngineEntry,
  type EngineFile
} from '../shared/engines'
import { IPC } from '../shared/types'
import { refreshEngineStates } from './downloads'
import { log } from './logger'

// Downloads may only come from our own releases or the upstream projects' releases.
const ALLOWED_URLS = [
  ...(ENGINE_REPO ? [`https://github.com/${ENGINE_REPO}/releases/download/`] : []),
  'https://github.com/ggml-org/whisper.cpp/releases/download/',
  'https://github.com/ggml-org/llama.cpp/releases/download/',
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/'
]

let published: EngineEntry[] = []

function cacheFile(): string {
  return join(app.getPath('userData'), 'engine-list.json')
}

const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)

function validFile(raw: unknown): EngineFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { url, bytes, sha256 } = raw as Record<string, unknown>
  if (typeof url !== 'string' || !ALLOWED_URLS.some((prefix) => url.startsWith(prefix))) return null
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0 || bytes > 4e9) return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
  return { url, bytes, sha256 }
}

/** The list is downloaded data, so every field is checked; anything odd drops that entry. */
function validEntry(raw: unknown): EngineEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(r.id)) return null
  if (!oneOf(r.engine, ['llama', 'whisper', 'ffmpeg', 'sherpa'] as const)) return null
  if (!oneOf(r.backend, ['cuda', 'metal', 'vulkan', 'cpu'] as const)) return null
  if (!oneOf(r.platform, ['win32', 'linux', 'darwin'] as const)) return null
  if (!oneOf(r.arch, ['x64', 'arm64'] as const)) return null
  if (typeof r.binary !== 'string' || !/^[a-z0-9-]{1,60}$/.test(r.binary)) return null
  if (typeof r.version !== 'string' || !/^[\w.-]{1,40}$/.test(r.version)) return null
  if (!Array.isArray(r.files) || r.files.length === 0 || r.files.length > 4) return null
  const files = r.files.map(validFile)
  if (files.some((file) => file === null)) return null
  return {
    id: r.id,
    engine: r.engine,
    backend: r.backend,
    platform: r.platform,
    arch: r.arch,
    binary: r.binary,
    version: r.version,
    license: typeof r.license === 'string' ? r.license.slice(0, 200) : 'see upstream',
    files: files as EngineFile[]
  }
}

function parse(text: string): EngineEntry[] {
  const raw = JSON.parse(text) as { schema?: unknown; engines?: unknown }
  if (raw.schema !== 1 || !Array.isArray(raw.engines)) throw new Error('unknown engine list format')
  return raw.engines.map(validEntry).filter((entry): entry is EngineEntry => entry !== null)
}

function use(entries: EngineEntry[]): void {
  published = entries
  applyEngineList(entries)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.onEngineList, entries)
  }
  refreshEngineStates()
}

/** The list currently applied, for the renderer to apply to its own copy of ENGINES. */
export function currentEngineList(): EngineEntry[] {
  return published
}

/** Applies the last downloaded list right away, then checks for a newer one in the background. */
export function loadEngineList(): void {
  try {
    use(parse(readFileSync(cacheFile(), 'utf8')))
  } catch {
    // No list downloaded yet: the built-in engines are used.
  }
  void refreshEngineList()
}

async function refreshEngineList(): Promise<void> {
  if (!ENGINE_LIST_URL) return
  try {
    const response = await fetch(ENGINE_LIST_URL, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    const entries = parse(text)
    writeFileSync(cacheFile(), text)
    use(entries)
    log.info('engines', `engine list: ${entries.length} tested builds`)
  } catch (err) {
    log.warn('engines', `could not check for engine updates: ${String(err)}`)
  }
}
