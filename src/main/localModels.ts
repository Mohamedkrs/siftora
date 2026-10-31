import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  type Dirent,
  type Stats
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { CATALOG } from '../shared/catalog'
import type { ModelState, ScannedModel } from '../shared/types'
import { readGgufInfo } from './gguf'
import { deleteModel, emitModelState, modelsDir, settledState } from './downloads'
import { getSettings, setSettings } from './settings'

const NOT_SUPPORTED =
  'Not a supported model file. Use a .gguf language model or a whisper.cpp ggml .bin file.'
const MIN_MODEL_BYTES = 50 * 1024 * 1024

export interface InspectedModel {
  path: string
  name: string
  bytes: number
  kind: 'transcription' | 'llm'
  catalogId?: string
  /** Same model as catalogId per its GGUF labels, but not the identical file. */
  sameModel?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function modelName(path: string): string {
  return basename(path).replace(/\.(gguf|bin)$/i, '')
}

function firstBytes(path: string, length: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function walk(dir: string, maxDepth: number, visit: (file: string) => void, depth = 0): void {
  if (depth > maxDepth) return

  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, maxDepth, visit, depth + 1)
    else if (entry.isFile() || entry.isSymbolicLink()) visit(full)
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function installedState(id: string, bytes: number): ModelState {
  return { id, status: 'installed', receivedBytes: bytes, bytesPerSec: 0, etaSec: null }
}

export function inspectModelFile(path: string): InspectedModel {
  let stats: Stats
  try {
    stats = statSync(path)
  } catch {
    throw new Error(NOT_SUPPORTED)
  }
  if (!stats.isFile()) throw new Error(NOT_SUPPORTED)

  let head: Buffer
  try {
    head = firstBytes(path, 4)
  } catch {
    throw new Error(NOT_SUPPORTED)
  }

  const kind =
    head.toString('latin1') === 'GGUF'
      ? 'llm'
      : head[0] === 0x6c && head[1] === 0x6d && head[2] === 0x67 && head[3] === 0x67
        ? 'transcription'
        : null
  if (!kind) throw new Error(NOT_SUPPORTED)

  const name = ollamaName(path) ?? modelName(path)

  if (kind === 'llm') {
    let gguf: ReturnType<typeof readGgufInfo> = {}
    try {
      gguf = readGgufInfo(path)
    } catch {
      // Unreadable header: fall through to an unmatched custom model.
    }
    const match = CATALOG.find(
      (model) =>
        model.gguf &&
        model.gguf.architecture === gguf.architecture &&
        model.gguf.sizeLabel.toLowerCase() === gguf.sizeLabel?.toLowerCase()
    )
    if (match) return { path, name, bytes: stats.size, kind, catalogId: match.id, sameModel: true }
    return { path, name: gguf.name && name.startsWith('sha256-') ? gguf.name : name, bytes: stats.size, kind }
  }

  const catalog = CATALOG.find((model) => model.bytes === stats.size && model.kind === kind)
  return catalog
    ? { path, name, bytes: stats.size, kind, catalogId: catalog.id }
    : { path, name, bytes: stats.size, kind }
}

/** "qwen3:14b (Ollama)" for a file inside an Ollama blobs folder, found via its manifests. */
function ollamaName(path: string): string | null {
  const file = basename(path)
  if (!file.startsWith('sha256-') || basename(dirname(path)) !== 'blobs') return null
  const digest = `sha256:${file.slice(7)}`
  let found: string | null = null
  walk(join(dirname(dirname(path)), 'manifests'), 6, (manifest) => {
    if (found) return
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
      if (!isRecord(parsed) || !Array.isArray(parsed.layers)) return
      if (parsed.layers.some((layer) => isRecord(layer) && layer.digest === digest)) {
        found = `${basename(dirname(manifest))}:${basename(manifest)} (Ollama)`
      }
    } catch {
      // Ignore unreadable manifests.
    }
  })
  return found
}

function scanOllama(
  root: string,
  add: (path: string, source: ScannedModel['source'], name?: string) => void
): void {
  walk(join(root, 'manifests'), 6, (file) => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!isRecord(parsed) || !Array.isArray(parsed.layers)) return

      for (const layer of parsed.layers) {
        if (!isRecord(layer)) continue
        if (layer.mediaType !== 'application/vnd.ollama.image.model') continue
        const digest = typeof layer.digest === 'string' ? layer.digest : ''
        if (!digest.startsWith('sha256:')) continue

        const blob = join(root, 'blobs', `sha256-${digest.slice(7)}`)
        const model = basename(dirname(file))
        const tag = basename(file)
        add(blob, 'Ollama', `${model}:${tag} (Ollama)`)
        break
      }
    } catch {
      // Ignore malformed or unreadable manifests.
    }
  })
}

/** Model files in well-known folders that are not already used by the app. */
export async function scanForModels(): Promise<ScannedModel[]> {
  try {
    const settings = getSettings()
    const skip = new Set<string>()
    for (const model of settings.customModels) skip.add(canonical(model.path))
    for (const path of Object.values(settings.linkedModels)) skip.add(canonical(path))

    const appModels = canonical(modelsDir())
    const found: ScannedModel[] = []
    const seen = new Set<string>()

    const add = (path: string, source: ScannedModel['source'], name?: string): void => {
      try {
        const real = canonical(path)
        if (seen.has(real) || skip.has(real)) return
        if (real === appModels || real.startsWith(`${appModels}${sep}`)) return

        const stats = statSync(real)
        if (!stats.isFile() || stats.size < MIN_MODEL_BYTES) return

        const info = inspectModelFile(real)
        seen.add(real)
        found.push({
          path: real,
          name: name ?? info.name,
          bytes: info.bytes,
          kind: info.kind,
          source
        })
      } catch {
        // Skip files that vanish or are not model files.
      }
    }

    scanOllama(process.env.OLLAMA_MODELS ?? join(homedir(), '.ollama', 'models'), add)

    for (const dir of [
      join(homedir(), '.lmstudio', 'models'),
      join(homedir(), '.cache', 'lm-studio', 'models')
    ]) {
      walk(dir, 4, (file) => {
        if (/\.gguf$/i.test(basename(file))) add(file, 'LM Studio')
      })
    }

    walk(join(homedir(), '.cache', 'huggingface', 'hub'), 6, (file) => {
      const name = basename(file)
      if (/\.gguf$/i.test(name) || /^ggml-.+\.bin$/i.test(name)) add(file, 'Hugging Face')
    })

    return found
  } catch {
    return []
  }
}

/** Link a catalogue file when its hash matches, otherwise record it as a custom model. */
export async function addCustomModel(path: string, name?: string): Promise<string> {
  const info = inspectModelFile(path)

  if (info.catalogId && info.sameModel) {
    // Same model, different packaging (e.g. Ollama's own GGUF): use it as that catalog model.
    const current = getSettings()
    setSettings({ linkedModels: { ...current.linkedModels, [info.catalogId]: path } })
    emitModelState(installedState(info.catalogId, info.bytes))
    return info.catalogId
  }

  if (info.catalogId) {
    const entry = CATALOG.find((model) => model.id === info.catalogId)
    if (entry) {
      const previous = settledState(entry.id)
      emitModelState({
        id: entry.id,
        status: 'verifying',
        receivedBytes: 0,
        bytesPerSec: 0,
        etaSec: null
      })

      const digest = await sha256File(path)
      if (digest === entry.sha256) {
        const current = getSettings()
        setSettings({ linkedModels: { ...current.linkedModels, [entry.id]: path } })
        emitModelState(installedState(entry.id, entry.bytes))
        return entry.id
      }

      if (previous) emitModelState(previous)
    }
  }

  const id = `custom-${createHash('sha1').update(path).digest('hex').slice(0, 12)}`
  const current = getSettings()
  if (!current.customModels.some((model) => model.id === id)) {
    setSettings({
      customModels: [
        ...current.customModels,
        { id, kind: info.kind, name: name ?? info.name, path, bytes: info.bytes }
      ]
    })
  }
  emitModelState(installedState(id, info.bytes))
  return id
}

/** Remove the entry only; the user's file is never deleted. */
export async function removeCustomModel(id: string): Promise<void> {
  await deleteModel(id)
}
