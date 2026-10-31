import { execFile } from 'node:child_process'
import { cpus, totalmem } from 'node:os'
import { CATALOG, type ModelEntry } from '../shared/catalog'
import {
  ENGINES,
  engineBytes,
  pickEngine,
  type Backend,
  type EngineEntry,
  type EngineName
} from '../shared/engines'
import type {
  EngineBackend,
  EngineOption,
  GpuInfo,
  HardwareInfo,
  Recommendation,
  RequiredEngines
} from '../shared/types'
import { getSettings } from './settings'

const GB = 1024 ** 3
const MIB = 1024 ** 2

let cached: HardwareInfo | null = null
let pending: Promise<HardwareInfo> | null = null

interface CimVideo {
  Name?: string
  AdapterRAM?: number
  DriverVersion?: string
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout))
    })
  })
}

function vendorOf(name: string): GpuInfo['vendor'] {
  const lower = name.toLowerCase()
  if (lower.includes('nvidia')) return 'nvidia'
  if (lower.includes('amd') || lower.includes('radeon')) return 'amd'
  if (lower.includes('intel')) return 'intel'
  if (lower.includes('apple')) return 'apple'
  return 'other'
}

async function detectNvidia(): Promise<{ gpus: GpuInfo[]; cuda: HardwareInfo['cuda'] }> {
  const cuda: HardwareInfo['cuda'] = { usable: false, driverVersion: null, cudaVersion: null }
  const csv = await run('nvidia-smi', [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader,nounits'
  ])
  if (!csv) return { gpus: [], cuda }

  const gpus: GpuInfo[] = []
  for (const line of csv.split(/\r?\n/)) {
    const parts = line.split(',').map((part) => part.trim())
    if (parts.length < 3 || !parts[0]) continue
    const mib = Number(parts[1])
    gpus.push({
      name: parts[0],
      vendor: 'nvidia',
      vramBytes: Number.isFinite(mib) && mib > 0 ? Math.round(mib * MIB) : null,
      driver: parts[2] || null
    })
  }

  if (gpus.length === 0) return { gpus, cuda }

  const full = await run('nvidia-smi', [])
  const match = full?.match(/CUDA (?:UMD )?Version:\s*([\d.]+)/)
  cuda.usable = true
  cuda.driverVersion = gpus[0].driver
  cuda.cudaVersion = match ? match[1] : null
  return { gpus, cuda }
}

async function detectWindowsGpus(existing: GpuInfo[]): Promise<GpuInfo[]> {
  const script =
    'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json'
  const out = await run('powershell', ['-NoProfile', '-Command', script])
  if (!out) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(out.replace(/^\uFEFF/, ''))
  } catch {
    return []
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  const known = new Set(existing.map((gpu) => gpu.name.toLowerCase()))
  const gpus: GpuInfo[] = []

  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as CimVideo
    const name = typeof record.Name === 'string' ? record.Name.trim() : ''
    // Skip software/virtual adapters (Basic Display, VR/remote-desktop virtual monitors).
    if (!name || /Basic Display|Virtual|Remote Display|Parsec|Indirect/i.test(name)) continue
    if (known.has(name.toLowerCase())) continue

    const ram = record.AdapterRAM
    gpus.push({
      name,
      vendor: vendorOf(name),
      // AdapterRAM wraps at 4 GB, so it is only trustworthy below that.
      vramBytes: typeof ram === 'number' && ram > 0 && ram !== 4294967295 ? ram : null,
      driver: typeof record.DriverVersion === 'string' ? record.DriverVersion : null
    })
  }

  return gpus
}

async function detectLinuxGpus(): Promise<GpuInfo[]> {
  const out = await run('lspci', [])
  if (!out) return []

  return out
    .split(/\r?\n/)
    .filter((line) => /VGA|3D|Display/i.test(line))
    .map((line) => {
      const name = line.replace(/^[0-9a-f]+:[0-9a-f.]+[^:]*:\s*/i, '').trim()
      return { name, vendor: vendorOf(name), vramBytes: null, driver: null }
    })
    .filter((gpu) => gpu.name.length > 0)
}

async function collect(): Promise<HardwareInfo> {
  const cpuList = cpus()
  const cpuModel = cpuList.length > 0 ? cpuList[0].model.trim() : 'Unknown CPU'
  const ramBytes = totalmem()
  const metal = process.platform === 'darwin' && process.arch === 'arm64'

  let gpus: GpuInfo[] = []
  let cuda: HardwareInfo['cuda'] = { usable: false, driverVersion: null, cudaVersion: null }

  if (metal) {
    gpus = [{ name: 'Apple Silicon GPU', vendor: 'apple', vramBytes: null, driver: null }]
  } else {
    const nvidia = await detectNvidia()
    gpus = nvidia.gpus
    cuda = nvidia.cuda

    if (process.platform === 'win32') {
      gpus = [...gpus, ...(await detectWindowsGpus(gpus))]
    } else if (process.platform === 'linux') {
      // lspci repeats GPUs nvidia-smi already reported.
      const others = (await detectLinuxGpus()).filter(
        (gpu) => gpu.vendor !== 'nvidia' || gpus.length === 0
      )
      gpus = [...gpus, ...others]
    }
  }

  const amdOrIntel = gpus.some((gpu) => gpu.vendor === 'amd' || gpu.vendor === 'intel')
  const backend: HardwareInfo['backend'] = cuda.usable
    ? 'cuda'
    : metal
      ? 'metal'
      : amdOrIntel
        ? 'vulkan'
        : 'cpu'

  const nvidiaBytes = gpus
    .filter((gpu) => gpu.vendor === 'nvidia' && gpu.vramBytes)
    .reduce((sum, gpu) => sum + (gpu.vramBytes ?? 0), 0)

  const memoryBudgetBytes =
    backend === 'cuda'
      ? nvidiaBytes || Math.round(ramBytes * 0.5)
      : backend === 'metal'
        ? Math.round(ramBytes * 0.65)
        : Math.round(ramBytes * 0.5)

  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel,
    cores: cpuList.length,
    ramBytes,
    gpus,
    cuda,
    backend,
    memoryBudgetBytes
  }
}

const ENGINE_NAMES: EngineName[] = ['whisper', 'llama', 'ffmpeg']

const ENGINE_LABELS: Record<Backend, string> = {
  cuda: 'GPU accelerated — NVIDIA CUDA',
  metal: 'GPU accelerated — Apple Metal',
  vulkan: 'GPU accelerated — Vulkan',
  cpu: 'CPU only (works everywhere, slower)'
}

const BACKEND_CHOICES: Backend[] = ['cuda', 'metal', 'vulkan', 'cpu']

function resolvedBackend(hw: HardwareInfo, preferred: EngineBackend): Backend {
  return preferred === 'auto' ? hw.backend : preferred
}

/** Engine builds this machine needs, best available per engine for the chosen backend. */
export function requiredEngines(hw: HardwareInfo, preferred: EngineBackend = 'auto'): string[] {
  const backend = resolvedBackend(hw, preferred)
  return ENGINE_NAMES
    .map((name) => pickEngine(name, process.platform, process.arch, backend))
    .filter((entry): entry is EngineEntry => entry !== null)
    .map((entry) => entry.id)
}

export async function requiredEngineInfo(): Promise<RequiredEngines> {
  const hw = await detectHardware()
  const preferred = getSettings().engineBackend
  const backend = resolvedBackend(hw, preferred)
  return {
    ids: requiredEngines(hw, preferred),
    missing: ENGINE_NAMES.filter(
      (name) => pickEngine(name, process.platform, process.arch, backend) === null
    )
  }
}

/** One engine choice per backend that has a build for this OS/arch (CPU is always offered). */
export async function engineOptions(): Promise<EngineOption[]> {
  const hw = await detectHardware()
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64'
  const options: EngineOption[] = []

  for (const backend of BACKEND_CHOICES) {
    const hasBuild = ENGINES.some(
      (entry) =>
        entry.platform === process.platform &&
        entry.arch === process.arch &&
        entry.backend === backend
    )
    if (!hasBuild && backend !== 'cpu') continue

    const ids = requiredEngines(hw, backend)
    const entries = ids
      .map((id) => ENGINES.find((entry) => entry.id === id))
      .filter((entry): entry is EngineEntry => entry !== undefined)

    options.push({
      backend,
      label: ENGINE_LABELS[backend],
      bytes: entries.reduce((sum, entry) => sum + engineBytes(entry), 0),
      ids,
      recommended: backend === hw.backend,
      available:
        backend === 'cuda' ? hw.cuda.usable : backend === 'metal' ? appleSilicon : true
    })
  }

  return options
}

export async function detectHardware(force = false): Promise<HardwareInfo> {
  if (force) {
    cached = null
    pending = null
  } else {
    if (cached) return cached
    if (pending) return pending
  }

  const run = collect()
  pending = run

  try {
    const result = await run
    if (pending === run) cached = result
    return result
  } finally {
    if (pending === run) pending = null
  }
}

function gb(bytes: number): string {
  return `${(bytes / GB).toFixed(1).replace(/\.0$/, '')} GB`
}

function largestWithin(models: ModelEntry[], maxBytes: number): ModelEntry | null {
  let best: ModelEntry | null = null
  for (const model of models) {
    if (model.memoryBytes > maxBytes) continue
    if (!best || model.memoryBytes > best.memoryBytes) best = model
  }
  return best
}

export function recommend(hw: HardwareInfo): Recommendation {
  const budget = hw.memoryBudgetBytes
  const cpu = hw.backend === 'cpu'

  const transcriptionModels = CATALOG.filter(
    (m) => m.kind === 'transcription' && (!cpu || m.memoryBytes <= GB)
  )
  const llmModels = CATALOG.filter((m) => {
    if (m.kind !== 'llm') return false
    if (cpu) return m.id === 'qwen3-4b'
    return m.id !== 'qwen3-14b' || budget >= 20 * GB
  })

  const byMemory = [...llmModels].sort((a, b) => b.memoryBytes - a.memoryBytes)
  let llm: ModelEntry | null = null
  let transcription: ModelEntry | null = null

  for (const candidate of byMemory) {
    const fit = largestWithin(transcriptionModels, budget - candidate.memoryBytes)
    if (fit) {
      llm = candidate
      transcription = fit
      break
    }
  }

  if (!llm) llm = CATALOG.find((m) => m.id === 'qwen3-4b') ?? CATALOG[0]
  if (!transcription) {
    transcription = CATALOG.find((m) => m.id === 'whisper-base') ?? CATALOG[0]
  }

  const reasons: string[] = []
  const gpu = hw.gpus.find((g) => g.vendor === 'nvidia') ?? hw.gpus[0]

  if (hw.backend === 'cuda' && gpu) {
    const vram = gpu.vramBytes ? `${gb(gpu.vramBytes)} VRAM` : 'unknown VRAM'
    reasons.push(`${gpu.name} with ${vram} — CUDA acceleration available.`)
  } else if (hw.backend === 'metal') {
    reasons.push('Apple Silicon GPU — Metal acceleration available.')
  } else if (hw.backend === 'vulkan' && gpu) {
    reasons.push(`${gpu.name} — Vulkan acceleration available.`)
  } else {
    reasons.push('No compatible GPU found — everything runs on the CPU.')
  }

  reasons.push(`Picked ${llm.name} and ${transcription.name} to fit ${gb(budget)} of memory.`)

  if (cpu) reasons.push('CPU-only machines are capped at the smaller models for reasonable speed.')

  return { transcription: transcription.id, llm: llm.id, reasons }
}
