import type { Backend, EngineEntry } from './engines'

export type Layout = 'blurred' | 'focused'

export type EngineBackend = Backend | 'auto'

export interface CustomModel {
  id: string
  kind: 'transcription' | 'llm'
  name: string
  path: string
  bytes: number
}

export interface EngineOption {
  backend: Backend
  label: string
  bytes: number
  ids: string[]
  recommended: boolean
  available: boolean
}

export interface ScannedModel {
  path: string
  name: string
  bytes: number
  kind: 'transcription' | 'llm'
  source: 'Ollama' | 'LM Studio' | 'Hugging Face' | 'Folder'
}

export interface SubtitleStyle {
  font: string
  sizePx: number
  color: string
  highlight: boolean
  highlightColor: string
  outline: boolean
  outlineColor: string
  /** Vertical center of the captions, in % of the frame height (5-95). */
  positionY: number
  uppercase: boolean
  /** Color each speaker's lines differently (needs speaker detection). */
  speakerColors: boolean
  /** Colors for the speakers who talk most (1-8); everyone beyond gets otherSpeakersColor. */
  speakerPalette: string[]
  otherSpeakersColor: string
}

export const MAX_SPEAKER_COLORS = 8
/** Suggested colors when adding speakers, in order. */
export const SPEAKER_COLOR_SUGGESTIONS = [
  '#FFFFFF', '#4FC3F7', '#FF8A65', '#AED581', '#BA68C8', '#FFD54F', '#F06292', '#4DB6AC'
]

/**
 * Caption fonts bundled in resources/fonts. `weight` is the weight the preview uses; `assName`
 * is the font's own family name, which libass matches when rendering.
 */
export const CAPTION_FONTS = [
  { family: 'Montserrat', weight: 800, assName: 'Montserrat ExtraBold' },
  { family: 'Poppins', weight: 900, assName: 'Poppins Black' },
  { family: 'Anton', weight: 400, assName: 'Anton' },
  { family: 'Bebas Neue', weight: 400, assName: 'Bebas Neue' }
] as const

import type { Job } from './jobs'

export type EngineKind = 'llama' | 'whisper' | 'ffmpeg'

/** An engine binary found on the computer (not installed by the app). */
export interface SystemEngine {
  engine: EngineKind
  path: string
  version: string | null
  backend: 'cuda' | 'metal' | 'vulkan' | 'cpu' | 'unknown'
  usable: boolean
  problem?: string
  /** Extra info shown to the user, e.g. "NVIDIA encoder available". */
  note?: string
  source: 'PATH' | 'winget' | 'scoop' | 'chocolatey' | 'homebrew' | 'system' | 'chosen'
}

export interface OllamaInfo {
  installed: boolean
  running: boolean
  version: string | null
  path: string | null
  models: { name: string; bytes: number; quantization: string | null; family: string | null; parameterSize: string | null }[]
}

export interface OpenAiWhisperInfo {
  path: string | null
  version: string | null
  cuda: boolean | null
  models: string[]
}

export interface Settings {
  outputDir: string
  layout: Layout
  subtitle: SubtitleStyle
  language: 'auto' | string
  maxClipSeconds: number
  minClipSeconds: number
  minScore: number
  onboarded: boolean
  transcriptionModel: string | null
  llmModel: string | null
  useVad: boolean
  /** Run speaker detection on new videos (needed for per-speaker caption colors). */
  detectSpeakers: boolean
  engineBackend: EngineBackend
  customModels: CustomModel[]
  linkedModels: Record<string, string>
  /** Engine binaries already on the computer, used instead of downloading. */
  enginePaths: Partial<Record<EngineKind, string>>
  llmProvider: 'app' | 'ollama'
  ollamaModel: string | null
  transcriptionProvider: 'app' | 'openai-whisper'
  openaiWhisperPath: string | null
  openaiWhisperModel: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  outputDir: '',
  layout: 'blurred',
  subtitle: {
    font: 'Montserrat',
    sizePx: 72,
    color: '#FFFFFF',
    highlight: true,
    highlightColor: '#FFD400',
    outline: true,
    outlineColor: '#000000',
    positionY: 50,
    uppercase: true,
    speakerColors: false,
    speakerPalette: ['#FFFFFF', '#4FC3F7', '#FF8A65', '#AED581'],
    otherSpeakersColor: '#E0E0E0'
  },
  language: 'auto',
  maxClipSeconds: 60,
  minClipSeconds: 15,
  minScore: 6,
  onboarded: false,
  transcriptionModel: null,
  llmModel: null,
  useVad: true,
  detectSpeakers: false,
  engineBackend: 'auto',
  customModels: [],
  linkedModels: {},
  enginePaths: {},
  llmProvider: 'app',
  ollamaModel: null,
  transcriptionProvider: 'app',
  openaiWhisperPath: null,
  openaiWhisperModel: null
}

export interface GpuInfo {
  name: string
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'other'
  vramBytes: number | null
  driver: string | null
}

export interface HardwareInfo {
  platform: string
  arch: string
  cpuModel: string
  cores: number
  ramBytes: number
  gpus: GpuInfo[]
  cuda: { usable: boolean; driverVersion: string | null; cudaVersion: string | null }
  backend: 'cuda' | 'metal' | 'vulkan' | 'cpu'
  memoryBudgetBytes: number
}

export interface Recommendation {
  transcription: string
  llm: string
  reasons: string[]
}

export type ModelStatus =
  | 'missing'
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'installed'
  | 'error'

export interface RequiredEngines {
  ids: string[]
  missing: ('whisper' | 'llama' | 'ffmpeg')[]
  /** Engines covered by something already on the computer (system binary, Ollama, Python Whisper). */
  satisfied: EngineKind[]
}

export interface ModelState {
  id: string
  status: ModelStatus
  receivedBytes: number
  bytesPerSec: number
  etaSec: number | null
  error?: string
  /** Installed engine with a newer tested version available (the version). */
  update?: string
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickOutputDir(): Promise<string | null>
  pickVideos(): Promise<string[]>
  log(level: 'info' | 'warn' | 'error', msg: string): void
  appInfo(): Promise<{ version: string; platform: string; userData: string }>
  getPathForFile(file: File): string
  getHardware(force?: boolean): Promise<HardwareInfo>
  getRecommendation(): Promise<Recommendation>
  getRequiredEngines(): Promise<RequiredEngines>
  getEngineOptions(): Promise<EngineOption[]>
  findSystemEngines(force?: boolean): Promise<SystemEngine[]>
  pickEngineBinary(engine: EngineKind): Promise<string | null>
  useSystemEngine(engine: EngineKind, path: string): Promise<{ ok: boolean; problem?: string }>
  stopUsingSystemEngine(engine: EngineKind): Promise<void>
  detectOllama(): Promise<OllamaInfo>
  detectOpenAiWhisper(): Promise<OpenAiWhisperInfo>
  listModels(): Promise<ModelState[]>
  downloadModels(ids: string[]): Promise<void>
  cancelDownload(id: string): Promise<void>
  deleteModel(id: string): Promise<void>
  openModelsFolder(): Promise<void>
  scanForModels(): Promise<ScannedModel[]>
  pickModelFile(): Promise<string | null>
  addCustomModel(path: string, name?: string): Promise<{ id?: string; error?: string }>
  removeCustomModel(id: string): Promise<void>
  onModelState(cb: (state: ModelState) => void): () => void
  /** Tested engine builds published for this app (see ENGINE_LIST_URL), and changes to them. */
  getEngineList(): Promise<EngineEntry[]>
  onEngineList(cb: (entries: EngineEntry[]) => void): () => void
  /** Queue videos (file paths or YouTube URLs) with the current settings. */
  addJobs(sources: string[]): Promise<Job[]>
  listJobs(): Promise<Job[]>
  cancelJob(id: string): Promise<void>
  removeJob(id: string): Promise<void>
  retryJob(id: string): Promise<void>
  /** Run moment discovery again on the cached transcript ("Find moments again"). */
  findAgain(id: string): Promise<void>
  renderClips(jobId: string, clipIds: string[]): Promise<void>
  openPath(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  onJobUpdate(cb: (job: Job) => void): () => void
}

export const IPC = {
  findSystemEngines: 'engines:find-system',
  pickEngineBinary: 'engines:pick-binary',
  useSystemEngine: 'engines:use-system',
  stopUsingSystemEngine: 'engines:stop-system',
  detectOllama: 'engines:detect-ollama',
  detectOpenAiWhisper: 'engines:detect-openai-whisper',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickOutputDir: 'dialog:pick-output-dir',
  pickVideos: 'dialog:pick-videos',
  log: 'app:log',
  appInfo: 'app:info',
  getHardware: 'hardware:get',
  getRecommendation: 'hardware:recommendation',
  getRequiredEngines: 'engines:required',
  getEngineOptions: 'engines:options',
  listModels: 'models:list',
  downloadModels: 'models:download',
  cancelDownload: 'models:cancel',
  deleteModel: 'models:delete',
  openModelsFolder: 'models:open-folder',
  scanForModels: 'models:scan',
  pickModelFile: 'dialog:pick-model-file',
  addCustomModel: 'models:add-custom',
  removeCustomModel: 'models:remove-custom',
  onModelState: 'models:state',
  getEngineList: 'engines:list',
  onEngineList: 'engines:list-changed',
  addJobs: 'jobs:add',
  listJobs: 'jobs:list',
  cancelJob: 'jobs:cancel',
  removeJob: 'jobs:remove',
  retryJob: 'jobs:retry',
  findAgain: 'jobs:find-again',
  renderClips: 'jobs:render',
  openPath: 'shell:open-path',
  showInFolder: 'shell:show-in-folder',
  onJobUpdate: 'jobs:update'
} as const
