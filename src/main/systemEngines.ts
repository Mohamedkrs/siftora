import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import type { EngineKind, OllamaInfo, OpenAiWhisperInfo, SystemEngine } from '../shared/types'
import { log } from './logger'

const BINARIES: Record<EngineKind, string> = {
  llama: 'llama-server',
  whisper: 'whisper-cli',
  ffmpeg: 'ffmpeg'
}
const EXE = process.platform === 'win32' ? '.exe' : ''
const MIN_LLAMA_BUILD = 5000

let cached: SystemEngine[] | null = null

/** Runs a program and returns stdout + stderr (many tools print versions to stderr). */
function run(file: string, args: string[], timeout = 8000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout ?? ''}\n${stderr ?? ''}` })
    })
  })
}

function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

/** Folders worth checking besides PATH, tagged with where they come from. */
function knownDirs(): { dir: string; source: SystemEngine['source'] }[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const winget = join(local, 'Microsoft', 'WinGet')
    // winget packages unpack as Packages\<id>\<versioned folder>\bin
    const wingetBins = subdirs(join(winget, 'Packages')).flatMap((pkg) => [
      pkg,
      join(pkg, 'bin'),
      ...subdirs(pkg).flatMap((inner) => [inner, join(inner, 'bin')])
    ])
    const scoopApps = subdirs(join(home, 'scoop', 'apps')).flatMap((appDir) => [
      join(appDir, 'current'),
      join(appDir, 'current', 'bin')
    ])
    return [
      { dir: join(winget, 'Links'), source: 'winget' },
      ...wingetBins.map((dir) => ({ dir, source: 'winget' as const })),
      { dir: join(home, 'scoop', 'shims'), source: 'scoop' },
      ...scoopApps.map((dir) => ({ dir, source: 'scoop' as const })),
      { dir: 'C:\\ProgramData\\chocolatey\\bin', source: 'chocolatey' }
    ]
  }
  if (process.platform === 'darwin') {
    return [
      { dir: '/opt/homebrew/bin', source: 'homebrew' },
      { dir: '/usr/local/bin', source: 'homebrew' }
    ]
  }
  return [
    { dir: '/usr/bin', source: 'system' },
    { dir: '/usr/local/bin', source: 'system' },
    { dir: join(home, '.local', 'bin'), source: 'system' }
  ]
}

async function onPath(name: string): Promise<string[]> {
  const { ok, out } =
    process.platform === 'win32' ? await run('where', [name]) : await run('which', ['-a', name])
  if (!ok) return []
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && existsSync(line))
}

async function inspectFfmpeg(path: string): Promise<Omit<SystemEngine, 'source'>> {
  const base: Omit<SystemEngine, 'source'> = { engine: 'ffmpeg', path, version: null, backend: 'cpu', usable: false }
  const version = await run(path, ['-hide_banner', '-version'])
  if (!version.ok) return { ...base, problem: 'Does not run' }
  base.version = version.out.match(/ffmpeg version (\S+)/)?.[1] ?? null
  if (!base.version) return { ...base, problem: 'Not an FFmpeg program' }

  const [filters, encoders] = await Promise.all([
    run(path, ['-hide_banner', '-filters']),
    run(path, ['-hide_banner', '-encoders'])
  ])
  if (!/\ssubtitles\s/.test(filters.out)) return { ...base, problem: 'Missing libass (subtitles filter)' }
  if (!/\slibx264\s/.test(encoders.out)) return { ...base, problem: 'Missing libx264' }
  if (!existsSync(join(dirname(path), `ffprobe${EXE}`))) {
    return { ...base, problem: 'ffprobe not found next to ffmpeg' }
  }
  const note = /\sh264_nvenc\s/.test(encoders.out) ? 'NVIDIA encoder available' : undefined
  return { ...base, usable: true, note }
}

async function inspectLlama(path: string): Promise<Omit<SystemEngine, 'source'>> {
  const base: Omit<SystemEngine, 'source'> = { engine: 'llama', path, version: null, backend: 'unknown', usable: false }
  const version = await run(path, ['--version'])
  const build = Number(version.out.match(/\(build (\d+)/)?.[1] ?? NaN)
  if (!Number.isFinite(build)) return { ...base, problem: 'Does not run or is not llama-server' }
  base.version = `build ${build}`
  if (build < MIN_LLAMA_BUILD) return { ...base, problem: `Too old (build ${build}), needs ${MIN_LLAMA_BUILD}+` }

  const devices = (await run(path, ['--list-devices'], 15000)).out
  base.backend = /CUDA/i.test(devices)
    ? 'cuda'
    : /Metal|MTL/i.test(devices)
      ? 'metal'
      : /Vulkan/i.test(devices)
        ? 'vulkan'
        : 'cpu'
  return { ...base, usable: true }
}

function ggmlBackendNextTo(path: string): SystemEngine['backend'] {
  const dir = dirname(real(path))
  let files: string[] = []
  try {
    files = readdirSync(dir).map((file) => file.toLowerCase())
  } catch {
    return 'unknown'
  }
  // ggml-cuda as a separate backend library, or CUDA linked in and shipped with NVIDIA's runtime.
  if (files.some((file) => file.includes('ggml-cuda') || /^(cublas|cudart)64/.test(file))) return 'cuda'
  if (files.some((file) => file.includes('ggml-vulkan'))) return 'vulkan'
  if (files.some((file) => file.includes('ggml-metal')) || (process.platform === 'darwin' && process.arch === 'arm64')) {
    return 'metal'
  }
  return 'cpu'
}

async function inspectWhisper(path: string): Promise<Omit<SystemEngine, 'source'>> {
  const base: Omit<SystemEngine, 'source'> = { engine: 'whisper', path, version: null, backend: 'unknown', usable: false }
  const help = await run(path, ['--help'])
  if (!/usage/i.test(help.out)) return { ...base, problem: 'Does not run or is not whisper-cli' }
  if (!help.out.includes('-ojf')) return { ...base, problem: 'Too old: no --output-json-full' }
  return { ...base, backend: ggmlBackendNextTo(path), usable: true }
}

/** Checks one binary (found or chosen by the user) and says whether the app can use it. */
export async function inspectEngineBinary(
  engine: EngineKind,
  path: string,
  source: SystemEngine['source'] = 'chosen'
): Promise<SystemEngine> {
  const result =
    engine === 'ffmpeg' ? await inspectFfmpeg(path) : engine === 'llama' ? await inspectLlama(path) : await inspectWhisper(path)
  return { ...result, source }
}

/** llama-server / whisper-cli / ffmpeg already installed on the computer. Never throws. */
export async function findSystemEngines(force = false): Promise<SystemEngine[]> {
  if (cached && !force) return cached
  const ownEngines = real(join(app.getPath('userData'), 'engines'))
  const found: SystemEngine[] = []
  const seen = new Set<string>()

  for (const engine of Object.keys(BINARIES) as EngineKind[]) {
    const file = `${BINARIES[engine]}${EXE}`
    const candidates: { path: string; source: SystemEngine['source'] }[] = [
      ...(await onPath(BINARIES[engine])).map((path) => ({ path, source: 'PATH' as const })),
      ...knownDirs().map(({ dir, source }) => ({ path: join(dir, file), source }))
    ]
    for (const { path, source } of candidates) {
      if (!existsSync(path)) continue
      const key = real(path).toLowerCase()
      if (seen.has(key) || key.startsWith(`${ownEngines.toLowerCase()}${sep}`)) continue
      seen.add(key)
      try {
        found.push(await inspectEngineBinary(engine, path, source))
      } catch (err) {
        log.warn('engines', `could not inspect ${path}: ${String(err)}`)
      }
    }
  }

  cached = found
  return found
}

function ollamaBase(): string {
  const host = process.env.OLLAMA_HOST
  if (!host) return 'http://127.0.0.1:11434'
  return host.startsWith('http') ? host.replace(/\/$/, '') : `http://${host}`
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function detectOllama(): Promise<OllamaInfo> {
  const info: OllamaInfo = { installed: false, running: false, version: null, path: null, models: [] }
  const candidates = [
    ...(await onPath('ollama')),
    ...(process.platform === 'win32'
      ? [join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'Ollama', 'ollama.exe')]
      : process.platform === 'darwin'
        ? ['/Applications/Ollama.app/Contents/Resources/ollama', '/usr/local/bin/ollama']
        : ['/usr/bin/ollama', '/usr/local/bin/ollama'])
  ]
  info.path = candidates.find((path) => existsSync(path)) ?? null
  info.installed = info.path !== null

  try {
    const version = (await getJson(`${ollamaBase()}/api/version`)) as { version?: unknown }
    info.running = true
    info.installed = true
    info.version = typeof version.version === 'string' ? version.version : null
    const tags = (await getJson(`${ollamaBase()}/api/tags`)) as { models?: unknown }
    if (Array.isArray(tags.models)) {
      for (const model of tags.models as Record<string, unknown>[]) {
        const details = (model.details ?? {}) as Record<string, unknown>
        if (typeof model.name !== 'string') continue
        info.models.push({
          name: model.name,
          bytes: typeof model.size === 'number' ? model.size : 0,
          quantization: typeof details.quantization_level === 'string' ? details.quantization_level : null,
          family: typeof details.family === 'string' ? details.family : null,
          parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size : null
        })
      }
    }
  } catch {
    // Not running (or not installed); `installed` still reflects the binary search.
  }
  return info
}

export async function detectOpenAiWhisper(): Promise<OpenAiWhisperInfo> {
  const info: OpenAiWhisperInfo = { path: null, version: null, cuda: null, models: [] }

  for (const path of await onPath('whisper')) {
    const help = await run(path, ['--help'], 30000)
    if (help.out.includes('--word_timestamps')) {
      info.path = path
      break
    }
  }

  const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  try {
    info.models = readdirSync(join(cacheRoot, 'whisper'))
      .filter((file) => file.endsWith('.pt'))
      .map((file) => basename(file, '.pt'))
  } catch {
    // No models downloaded yet.
  }

  if (!info.path) return info

  // whisper.exe lives in <python>\Scripts on Windows; elsewhere python3 sits next to it.
  const python =
    process.platform === 'win32'
      ? join(dirname(dirname(info.path)), 'python.exe')
      : join(dirname(info.path), 'python3')
  if (existsSync(python)) {
    const probe = await run(
      python,
      ['-I', '-c', 'import whisper, torch; print(whisper.__version__); print(torch.cuda.is_available())'],
      30000
    )
    const lines = probe.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (probe.ok && lines.length >= 2) {
      info.version = lines[0]
      info.cuda = lines[1] === 'True'
    }
  }
  return info
}
