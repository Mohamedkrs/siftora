import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { createHash, type Hash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent
} from 'node:fs'
import { basename, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { CATALOG, SPEAKER_MODEL_IDS, type ModelEntry } from '../shared/catalog'
import {
  builtInVersion,
  ENGINES,
  engineBytes,
  pickEngine,
  type Backend,
  type EngineEntry,
  type EngineFile,
  type EngineName
} from '../shared/engines'
import { IPC, type ModelState, type Settings } from '../shared/types'
import { log } from './logger'
import { getSettings, setSettings } from './settings'

type Item = ModelEntry | EngineEntry

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

function enginesDir(): string {
  const dir = join(app.getPath('userData'), 'engines')
  mkdirSync(dir, { recursive: true })
  return dir
}

function engineDir(entry: EngineEntry): string {
  return join(enginesDir(), entry.id)
}

function enginePart(file: EngineFile): string {
  const dir = join(enginesDir(), '.downloads')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${basename(file.url)}.part`)
}

function isEngine(item: Item): item is EngineEntry {
  return 'files' in item
}

function findItem(id: string): Item | undefined {
  return CATALOG.find((m) => m.id === id) ?? ENGINES.find((e) => e.id === id)
}

function filePath(entry: ModelEntry): string {
  return join(modelsDir(), entry.file)
}

// Linked files were checked when linked (hash, or GGUF labels for the same model packaged
// differently, so the size can differ); here we only need the file to still be there.
function linkedPath(id: string): string | null {
  const path = getSettings().linkedModels[id]
  if (!path) return null
  return fileSize(path) > 0 ? path : null
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function itemBytes(item: Item): number {
  return isEngine(item) ? engineBytes(item) : item.bytes
}

function isInstalled(item: Item): boolean {
  if (isEngine(item)) {
    try {
      if (!statSync(engineDir(item)).isDirectory()) return false
    } catch {
      return false
    }
    return findBinary(item) !== null
  }

  try {
    if (statSync(filePath(item)).size === item.bytes) return true
  } catch {
    // Not downloaded; a linked copy may still exist.
  }
  return linkedPath(item.id) !== null
}

function partSize(item: Item): number {
  if (isEngine(item)) {
    return item.files.reduce((sum, file) => sum + fileSize(enginePart(file)), 0)
  }
  return fileSize(`${filePath(item)}.part`)
}

function removeFile(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (err) {
    log.warn('downloads', `could not remove ${path}: ${String(err)}`)
  }
}

function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (err) {
    log.warn('downloads', `could not remove ${path}: ${String(err)}`)
  }
}

function searchBinary(dir: string, name: string): string | null {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = searchBinary(full, name)
      if (found) return found
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

/** The executable inside an installed engine folder, or null while it is missing. */
export function findBinary(entry: EngineEntry): string | null {
  const name = process.platform === 'win32' ? `${entry.binary}.exe` : entry.binary
  return searchBinary(engineDir(entry), name)
}

const BACKEND_ORDER: Backend[] = ['cuda', 'metal', 'vulkan', 'cpu']

/** Binary of the best installed build of `engineName` for this OS/arch. */
export function enginePath(engineName: EngineName): string | null {
  const own = engineName === 'sherpa' ? undefined : getSettings().enginePaths[engineName]
  if (own && existsSync(own)) return own
  for (const backend of BACKEND_ORDER) {
    const entry = pickEngine(engineName, process.platform, process.arch, backend)
    if (entry && isInstalled(entry)) return findBinary(entry)
  }
  return null
}

// Windows' bundled bsdtar can unpack .zip; Git's GNU tar (often first on PATH) cannot.
function tarPath(): string {
  if (process.platform !== 'win32') return 'tar'
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

function installedState(id: string, bytes: number): ModelState {
  return { id, status: 'installed', receivedBytes: bytes, bytesPerSec: 0, etaSec: null }
}

const VERSION_FILE = '.vcf-version'

/** Version written at install; installs from before that are the built-in version. */
function installedVersion(entry: EngineEntry): string | undefined {
  try {
    return readFileSync(join(engineDir(entry), VERSION_FILE), 'utf8').trim() || undefined
  } catch {
    return builtInVersion(entry.id)
  }
}

function initialState(item: Item): ModelState {
  if (isInstalled(item)) {
    const state = installedState(item.id, itemBytes(item))
    if (isEngine(item) && item.version && installedVersion(item) !== item.version) state.update = item.version
    return state
  }

  const known = active.get(item.id)
  if (known && known.status !== 'installed' && known.status !== 'missing') return known

  return { id: item.id, status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null }
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
  const custom = getSettings().customModels.map(
    (model) => active.get(model.id) ?? installedState(model.id, model.bytes)
  )
  return [...[...CATALOG, ...ENGINES].map(initialState), ...custom]
}

/** Re-send engine states after the engine list changed, so updates show up. */
export function refreshEngineStates(): void {
  for (const entry of ENGINES) {
    const known = active.get(entry.id)
    if (known && known.status !== 'installed' && known.status !== 'missing' && known.status !== 'error') continue
    active.delete(entry.id)
    broadcast(initialState(entry))
  }
}

/** Push a model state to the renderer, used by custom-model verification. */
export function emitModelState(state: ModelState): void {
  setState(state.id, state)
}

/** The state a known model shows when it is not mid-download. */
export function settledState(id: string): ModelState | null {
  const entry = findItem(id)
  return entry ? initialState(entry) : null
}

/** File for a catalog, linked or custom model, or null for an unknown id. */
export function modelFilePath(id: string): string | null {
  const entry = CATALOG.find((model) => model.id === id)
  if (entry) return linkedPath(entry.id) ?? filePath(entry)
  return getSettings().customModels.find((model) => model.id === id)?.path ?? null
}

export function downloadModels(requested: string[]): void {
  const sherpa = pickEngine('sherpa', process.platform, process.arch, 'cpu')
  const ids =
    sherpa && requested.some((id) => SPEAKER_MODEL_IDS.includes(id)) && !requested.includes(sherpa.id)
      ? [...requested, sherpa.id]
      : requested
  for (const id of ids) {
    const entry = findItem(id)
    if (!entry) continue

    const state = initialState(entry)
    if (
      (state.status === 'installed' && !state.update) ||
      state.status === 'queued' ||
      state.status === 'downloading' ||
      state.status === 'verifying' ||
      state.status === 'extracting'
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
      const entry = findItem(id)
      if (!entry) continue

      const job = isEngine(entry) ? installEngine(entry) : downloadOne(entry)
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

interface TransferResult {
  kind: 'ok' | 'aborted' | 'error'
  received: number
  digest?: string
  error?: string
}

/** Downloads one file into `part` (resuming when possible) and returns its SHA-256. */
async function transfer(
  id: string,
  file: EngineFile,
  part: string,
  signal: AbortSignal,
  total: number,
  offset: number,
  onProgress: (received: number, bytesPerSec: number, etaSec: number | null) => void
): Promise<TransferResult> {
  let received = fileSize(part)
  let hash = createHash('sha256')

  if (received > 0) {
    try {
      hash = await hashFile(part)
    } catch (err) {
      log.warn('downloads', `could not read partial ${id}, restarting: ${String(err)}`)
      removeFile(part)
      received = 0
      hash = createHash('sha256')
    }
  }

  if (signal.aborted) return { kind: 'aborted', received }

  if (received >= file.bytes) return { kind: 'ok', digest: hash.digest('hex'), received }

  const headers: Record<string, string> = {}
  if (received > 0) headers.Range = `bytes=${received}-`

  let response: Response
  try {
    response = await fetch(file.url, { headers, signal })
  } catch {
    if (signal.aborted) return { kind: 'aborted', received }
    return {
      kind: 'error',
      error: 'Download failed — check your connection and try again.',
      received
    }
  }

  if (!response.ok) {
    return {
      kind: 'error',
      error: `Download failed (HTTP ${response.status}). Try again later.`,
      received
    }
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
    return {
      kind: 'error',
      error: 'Download failed — empty response. Try again.',
      received
    }
  }

  let lastTime = Date.now()
  let lastBytes = received
  let bytesPerSec = 0
  let etaSec: number | null = null

  onProgress(offset + received, 0, null)

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
            ? Math.max(0, Math.ceil((total - offset - received) / bytesPerSec))
            : null
        onProgress(offset + received, bytesPerSec, etaSec)
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
  } catch {
    if (signal.aborted) return { kind: 'aborted', received }
    return {
      kind: 'error',
      error: 'Download failed — check your connection and try again.',
      received
    }
  }

  return { kind: 'ok', digest: hash.digest('hex'), received }
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

  const result = await transfer(
    entry.id,
    { url: entry.url, bytes: entry.bytes, sha256: entry.sha256 },
    part,
    controller.signal,
    entry.bytes,
    0,
    (received, bytesPerSec, etaSec) => {
      setState(entry.id, { status: 'downloading', receivedBytes: received, bytesPerSec, etaSec })
    }
  )

  controllers.delete(entry.id)

  if (result.kind === 'aborted') {
    fail(entry, null, true)
    return
  }

  if (result.kind === 'error') {
    const message = result.error ?? 'Download failed — check your connection and try again.'
    log.warn('downloads', `${entry.id} failed: ${message}`)
    setState(entry.id, {
      status: 'error',
      error: message,
      receivedBytes: partSize(entry),
      bytesPerSec: 0,
      etaSec: null
    })
    return
  }

  finish(entry, part, target, result.digest ?? '')
}

function runTar(archive: string, dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      tarPath(),
      ['-xf', archive, '-C', dir],
      { timeout: 10 * 60 * 1000, windowsHide: true },
      (err, _stdout, stderr) => {
        resolve(err ? String(stderr || err.message) : null)
      }
    )
  })
}

function unpackFailed(entry: EngineEntry, name: string): void {
  setState(entry.id, {
    status: 'error',
    error: `Could not unpack ${name}`,
    receivedBytes: engineBytes(entry),
    bytesPerSec: 0,
    etaSec: null
  })
}

/**
 * For engines marked `latest`, swap the pinned files for the newest stable build, verified with
 * the SHA-256 digest GitHub publishes for the asset. Falls back to the pinned files offline.
 */
async function withLatestFiles(entry: EngineEntry): Promise<EngineEntry> {
  if (!entry.latest) return entry
  try {
    const response = await fetch(
      `https://api.github.com/repos/${entry.latest.repo}/releases/tags/latest`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) }
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const release = (await response.json()) as {
      assets?: { name: string; size: number; digest?: string; browser_download_url: string }[]
    }
    const pattern = entry.latest.asset
    const newest = (release.assets ?? [])
      .map((asset) => ({ asset, match: pattern.exec(asset.name) }))
      .filter(({ asset, match }) => match && asset.digest?.startsWith('sha256:'))
      .sort((a, b) => {
        const [, aMajor, aMinor] = a.match as RegExpExecArray
        const [, bMajor, bMinor] = b.match as RegExpExecArray
        return Number(bMajor) - Number(aMajor) || Number(bMinor) - Number(aMinor)
      })[0]?.asset
    if (!newest?.digest) throw new Error('no matching asset')
    log.info('downloads', `${entry.id}: newest build is ${newest.name}`)
    return {
      ...entry,
      files: [{ url: newest.browser_download_url, bytes: newest.size, sha256: newest.digest.slice(7) }]
    }
  } catch (err) {
    log.warn('downloads', `${entry.id}: could not look up newest build, using pinned: ${String(err)}`)
    return entry
  }
}

async function installEngine(pinned: EngineEntry): Promise<void> {
  const entry = await withLatestFiles(pinned)
  const controller = new AbortController()
  controllers.set(entry.id, controller)
  const total = engineBytes(entry)
  log.info('downloads', `installing ${entry.id} (${entry.files.length} file(s))`)

  const parts = entry.files.map((file) => fileSize(enginePart(file)))
  let completed = 0

  for (let index = 0; index < entry.files.length; index += 1) {
    const file = entry.files[index]
    const part = enginePart(file)
    const pending = parts.slice(index + 1).reduce((sum, size) => sum + size, 0)
    const offset = completed + pending
    const result = await transfer(
      entry.id,
      file,
      part,
      controller.signal,
      total,
      offset,
      (received, bytesPerSec, etaSec) => {
        setState(entry.id, { status: 'downloading', receivedBytes: received, bytesPerSec, etaSec })
      }
    )

    if (result.kind === 'aborted') {
      controllers.delete(entry.id)
      setState(entry.id, {
        status: 'missing',
        receivedBytes: partSize(entry),
        bytesPerSec: 0,
        etaSec: null
      })
      log.info('downloads', `cancelled ${entry.id}`)
      return
    }

    if (result.kind === 'error') {
      controllers.delete(entry.id)
      const message = result.error ?? 'Download failed — check your connection and try again.'
      log.warn('downloads', `${entry.id} failed: ${message}`)
      setState(entry.id, {
        status: 'error',
        error: message,
        receivedBytes: offset + result.received,
        bytesPerSec: 0,
        etaSec: null
      })
      return
    }

    if (result.digest !== file.sha256) {
      removeFile(part)
      controllers.delete(entry.id)
      log.error('downloads', `checksum mismatch for ${entry.id} (${basename(part)})`)
      setState(entry.id, {
        status: 'error',
        error: 'Checksum mismatch — file was corrupted, try again',
        receivedBytes: offset,
        bytesPerSec: 0,
        etaSec: null
      })
      return
    }

    completed += file.bytes
  }

  setState(entry.id, {
    status: 'extracting',
    receivedBytes: total,
    bytesPerSec: 0,
    etaSec: null
  })
  log.info('downloads', `extracting ${entry.id}`)

  const dir = engineDir(entry)
  const tmp = `${dir}.tmp`

  try {
    removeDir(tmp)
    mkdirSync(tmp, { recursive: true })
  } catch (err) {
    controllers.delete(entry.id)
    log.error('downloads', `could not prepare ${tmp}: ${String(err)}`)
    unpackFailed(entry, basename(entry.files[0].url))
    return
  }

  for (const file of entry.files) {
    const failure = await runTar(enginePart(file), tmp)
    if (failure) {
      controllers.delete(entry.id)
      log.error('downloads', `could not unpack ${basename(file.url)}: ${failure}`)
      removeDir(tmp)
      unpackFailed(entry, basename(file.url))
      return
    }
  }

  try {
    // An update keeps the version it replaces next to it, so going back needs no download.
    if (existsSync(dir)) {
      removeDir(`${dir}.previous`)
      renameSync(dir, `${dir}.previous`)
    }
    renameSync(tmp, dir)
    writeFileSync(join(dir, VERSION_FILE), entry.version ?? '')
  } catch (err) {
    controllers.delete(entry.id)
    log.error('downloads', `could not install ${entry.id}: ${String(err)}`)
    removeDir(tmp)
    // Most likely the engine is running (Windows locks it); the old version is still in place.
    if (!existsSync(dir) && existsSync(`${dir}.previous`)) renameSync(`${dir}.previous`, dir)
    unpackFailed(entry, basename(entry.files[0].url))
    return
  }

  const binary = findBinary(entry)
  if (binary && process.platform !== 'win32') {
    try {
      chmodSync(binary, 0o755)
    } catch (err) {
      log.warn('downloads', `could not chmod ${binary}: ${String(err)}`)
    }
  }

  for (const file of entry.files) removeFile(enginePart(file))
  controllers.delete(entry.id)
  setState(entry.id, { status: 'installed', receivedBytes: total, bytesPerSec: 0, etaSec: null })
  log.info('downloads', `installed ${entry.id} (${total} bytes)`)
}

export function cancelDownload(id: string): void {
  const index = queue.indexOf(id)
  if (index !== -1) queue.splice(index, 1)

  const controller = controllers.get(id)
  if (controller) controller.abort()
  controllers.delete(id)

  const entry = findItem(id)
  if (!entry) return

  setState(id, {
    status: 'missing',
    receivedBytes: partSize(entry),
    bytesPerSec: 0,
    etaSec: null
  })
}

export async function deleteModel(id: string): Promise<void> {
  const settings = getSettings()

  // A linked catalog model is the user's own file, so only forget the link.
  if (settings.linkedModels[id]) {
    const linkedModels = { ...settings.linkedModels }
    delete linkedModels[id]
    setSettings({ linkedModels })
    setState(id, { status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null })
    clearSelection(id)
    return
  }

  const custom = settings.customModels.find((model) => model.id === id)
  if (custom) {
    setSettings({ customModels: settings.customModels.filter((model) => model.id !== id) })
    setState(id, { status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null })
    clearSelection(id)
    return
  }

  const entry = findItem(id)
  if (!entry) return

  cancelDownload(id)
  const job = runningJobs.get(id)
  if (job) await job.catch(() => undefined)

  if (isEngine(entry)) {
    removeDir(engineDir(entry))
    removeDir(`${engineDir(entry)}.tmp`)
    removeDir(`${engineDir(entry)}.previous`)
    for (const file of entry.files) removeFile(enginePart(file))
  } else {
    removeFile(filePath(entry))
    removeFile(`${filePath(entry)}.part`)
  }

  setState(id, { status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null })
  clearSelection(id)
}

function clearSelection(id: string): void {
  const settings = getSettings()
  const patch: Partial<Settings> = {}
  if (settings.transcriptionModel === id) patch.transcriptionModel = null
  if (settings.llmModel === id) patch.llmModel = null
  if (Object.keys(patch).length > 0) setSettings(patch)
}
