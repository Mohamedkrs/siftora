import { app, BrowserWindow } from 'electron'
import { createHash, type Hash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { CATALOG, type ModelEntry } from '../shared/catalog'
import { IPC, type ModelState, type Settings } from '../shared/types'
import { log } from './logger'
import { getSettings, setSettings } from './settings'

const active = new Map<string, ModelState>()
const queue: string[] = []
const controllers = new Map<string, AbortController>()
const runningJobs = new Map<string, Promise<void>>()
let running = false

export function modelsDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  mkdirSync(dir, { recursive: true })
  return dir
}

function filePath(entry: ModelEntry): string {
  return join(modelsDir(), entry.file)
}

function isInstalled(entry: ModelEntry): boolean {
  try {
    return statSync(filePath(entry)).size === entry.bytes
  } catch {
    return false
  }
}

function partSize(entry: ModelEntry): number {
  try {
    return statSync(`${filePath(entry)}.part`).size
  } catch {
    return 0
  }
}

function removeFile(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (err) {
    log.warn('downloads', `could not remove ${path}: ${String(err)}`)
  }
}

function initialState(entry: ModelEntry): ModelState {
  if (isInstalled(entry)) {
    return {
      id: entry.id,
      status: 'installed',
      receivedBytes: entry.bytes,
      bytesPerSec: 0,
      etaSec: null
    }
  }

  const known = active.get(entry.id)
  if (known && known.status !== 'installed' && known.status !== 'missing') return known

  return { id: entry.id, status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null }
}

function broadcast(state: ModelState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.onModelState, state)
  }
}

function setState(id: string, patch: Partial<ModelState>): ModelState {
  const current: ModelState = active.get(id) ?? {
    id,
    status: 'missing',
    receivedBytes: 0,
    bytesPerSec: 0,
    etaSec: null
  }
  const next: ModelState = { ...current, ...patch, id }
  if (next.status !== 'error') delete next.error
  active.set(id, next)
  broadcast(next)
  return next
}

export function listModels(): ModelState[] {
  return CATALOG.map(initialState)
}

export function downloadModels(ids: string[]): void {
  for (const id of ids) {
    const entry = CATALOG.find((m) => m.id === id)
    if (!entry) continue

    const state = initialState(entry)
    if (
      state.status === 'installed' ||
      state.status === 'queued' ||
      state.status === 'downloading' ||
      state.status === 'verifying'
    ) {
      continue
    }

    queue.push(id)
    setState(id, {
      status: 'queued',
      receivedBytes: partSize(entry),
      bytesPerSec: 0,
      etaSec: null
    })
  }

  void pump()
}

async function pump(): Promise<void> {
  if (running) return
  running = true

  try {
    while (queue.length > 0) {
      const id = queue.shift()
      if (!id) continue
      const entry = CATALOG.find((m) => m.id === id)
      if (!entry) continue

      const job = downloadOne(entry)
      runningJobs.set(id, job)
      try {
        await job
      } catch (err) {
        log.error('downloads', `unexpected failure for ${id}: ${String(err)}`)
      } finally {
        runningJobs.delete(id)
      }
    }
  } finally {
    running = false
  }
}

function hashFile(path: string): Promise<Hash> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash))
    stream.on('error', reject)
  })
}

function fail(entry: ModelEntry, err: unknown, aborted: boolean): void {
  if (aborted) {
    setState(entry.id, {
      status: 'missing',
      receivedBytes: partSize(entry),
      bytesPerSec: 0,
      etaSec: null
    })
    log.info('downloads', `cancelled ${entry.id}`)
    return
  }

  log.warn('downloads', `${entry.id} failed: ${String(err)}`)
  setState(entry.id, {
    status: 'error',
    error: 'Download failed — check your connection and try again.',
    receivedBytes: partSize(entry),
    bytesPerSec: 0,
    etaSec: null
  })
}

function finish(entry: ModelEntry, part: string, target: string, digest: string): void {
  setState(entry.id, {
    status: 'verifying',
    receivedBytes: entry.bytes,
    bytesPerSec: 0,
    etaSec: null
  })

  if (digest !== entry.sha256) {
    removeFile(part)
    setState(entry.id, {
      status: 'error',
      error: 'Checksum mismatch — file was corrupted, try again',
      receivedBytes: 0,
      bytesPerSec: 0,
      etaSec: null
    })
    log.error('downloads', `checksum mismatch for ${entry.id}`)
    return
  }

  try {
    removeFile(target)
    renameSync(part, target)
  } catch (err) {
    setState(entry.id, {
      status: 'error',
      error: 'Could not save the model file. Try again.',
      receivedBytes: 0,
      bytesPerSec: 0,
      etaSec: null
    })
    log.error('downloads', `could not install ${entry.id}: ${String(err)}`)
    return
  }

  setState(entry.id, {
    status: 'installed',
    receivedBytes: entry.bytes,
    bytesPerSec: 0,
    etaSec: null
  })
  log.info('downloads', `installed ${entry.id} (${entry.bytes} bytes)`)
}

async function downloadOne(entry: ModelEntry): Promise<void> {
  const controller = new AbortController()
  controllers.set(entry.id, controller)
  log.info('downloads', `downloading ${entry.id} from ${entry.url}`)

  const target = filePath(entry)
  const part = `${target}.part`
  let received = partSize(entry)
  let hash = createHash('sha256')

  if (received > 0) {
    try {
      hash = await hashFile(part)
    } catch (err) {
      log.warn('downloads', `could not read partial ${entry.id}, restarting: ${String(err)}`)
      removeFile(part)
      received = 0
      hash = createHash('sha256')
    }
  }

  if (controller.signal.aborted) {
    controllers.delete(entry.id)
    return
  }

  if (received >= entry.bytes) {
    finish(entry, part, target, hash.digest('hex'))
    controllers.delete(entry.id)
    return
  }

  const headers: Record<string, string> = {}
  if (received > 0) headers.Range = `bytes=${received}-`

  let response: Response
  try {
    response = await fetch(entry.url, { headers, signal: controller.signal })
  } catch (err) {
    controllers.delete(entry.id)
    fail(entry, err, controller.signal.aborted)
    return
  }

  if (!response.ok) {
    controllers.delete(entry.id)
    log.warn('downloads', `${entry.id} returned HTTP ${response.status}`)
    setState(entry.id, {
      status: 'error',
      error: `Download failed (HTTP ${response.status}). Try again later.`,
      receivedBytes: received,
      bytesPerSec: 0,
      etaSec: null
    })
    return
  }

  const append = received > 0 && response.status === 206
  if (received > 0 && response.status !== 206) {
    // The server ignored the Range request, so start the file over.
    removeFile(part)
    received = 0
    hash = createHash('sha256')
  }

  const body = response.body
  if (!body) {
    controllers.delete(entry.id)
    setState(entry.id, {
      status: 'error',
      error: 'Download failed — empty response. Try again.',
      receivedBytes: received,
      bytesPerSec: 0,
      etaSec: null
    })
    return
  }

  let lastTime = Date.now()
  let lastBytes = received
  let bytesPerSec = 0
  let etaSec: number | null = null

  setState(entry.id, {
    status: 'downloading',
    receivedBytes: received,
    bytesPerSec: 0,
    etaSec: null
  })

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      received += chunk.length

      const now = Date.now()
      const elapsed = (now - lastTime) / 1000
      if (elapsed >= 0.25) {
        const rate = (received - lastBytes) / elapsed
        bytesPerSec = bytesPerSec === 0 ? rate : bytesPerSec * 0.7 + rate * 0.3
        etaSec =
          bytesPerSec > 0
            ? Math.max(0, Math.ceil((entry.bytes - received) / bytesPerSec))
            : null
        setState(entry.id, {
          status: 'downloading',
          receivedBytes: received,
          bytesPerSec,
          etaSec
        })
        lastTime = now
        lastBytes = received
      }

      callback(null, chunk)
    }
  })

  try {
    await pipeline(
      Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(part, { flags: append ? 'a' : 'w' })
    )
  } catch (err) {
    controllers.delete(entry.id)
    fail(entry, err, controller.signal.aborted)
    return
  }

  controllers.delete(entry.id)
  finish(entry, part, target, hash.digest('hex'))
}

export function cancelDownload(id: string): void {
  const index = queue.indexOf(id)
  if (index !== -1) queue.splice(index, 1)

  const controller = controllers.get(id)
  if (controller) controller.abort()
  controllers.delete(id)

  const entry = CATALOG.find((m) => m.id === id)
  if (!entry) return

  setState(id, {
    status: 'missing',
    receivedBytes: partSize(entry),
    bytesPerSec: 0,
    etaSec: null
  })
}

export async function deleteModel(id: string): Promise<void> {
  const entry = CATALOG.find((m) => m.id === id)
  if (!entry) return

  cancelDownload(id)
  const job = runningJobs.get(id)
  if (job) await job.catch(() => undefined)

  removeFile(filePath(entry))
  removeFile(`${filePath(entry)}.part`)

  setState(id, { status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null })

  const settings = getSettings()
  const patch: Partial<Settings> = {}
  if (settings.transcriptionModel === id) patch.transcriptionModel = null
  if (settings.llmModel === id) patch.llmModel = null
  if (Object.keys(patch).length > 0) setSettings(patch)
}
