export type Layout = 'blurred' | 'focused'

export interface SubtitleStyle {
  font: string
  sizePx: number
  color: string
  highlight: boolean
  highlightColor: string
  outline: boolean
  outlineColor: string
  position: 'bottom' | 'middle' | 'top'
  uppercase: boolean
  /** Color each speaker's lines differently (needs speaker detection). */
  speakerColors: boolean
  speakerPalette: string[]
}

export const SPEAKER_SLOTS = 4

/** Caption fonts bundled in resources/fonts. `weight` is the weight the captions use. */
export const CAPTION_FONTS = [
  { family: 'Montserrat', weight: 800 },
  { family: 'Poppins', weight: 900 },
  { family: 'Anton', weight: 400 },
  { family: 'Bebas Neue', weight: 400 }
] as const

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
    position: 'middle',
    uppercase: true,
    speakerColors: false,
    speakerPalette: ['#FFFFFF', '#4FC3F7', '#FF8A65', '#AED581']
  },
  language: 'auto',
  maxClipSeconds: 60,
  minClipSeconds: 15,
  minScore: 6,
  onboarded: false,
  transcriptionModel: null,
  llmModel: null,
  useVad: true
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

export type ModelStatus = 'missing' | 'queued' | 'downloading' | 'verifying' | 'installed' | 'error'

export interface ModelState {
  id: string
  status: ModelStatus
  receivedBytes: number
  bytesPerSec: number
  etaSec: number | null
  error?: string
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickOutputDir(): Promise<string | null>
  pickVideos(): Promise<string[]>
  log(level: 'info' | 'warn' | 'error', msg: string): void
  appInfo(): Promise<{ version: string; platform: string; userData: string }>
  getPathForFile(file: File): string
  getHardware(): Promise<HardwareInfo>
  getRecommendation(): Promise<Recommendation>
  listModels(): Promise<ModelState[]>
  downloadModels(ids: string[]): Promise<void>
  cancelDownload(id: string): Promise<void>
  deleteModel(id: string): Promise<void>
  openModelsFolder(): Promise<void>
  onModelState(cb: (state: ModelState) => void): () => void
}

export const IPC = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickOutputDir: 'dialog:pick-output-dir',
  pickVideos: 'dialog:pick-videos',
  log: 'app:log',
  appInfo: 'app:info',
  getHardware: 'hardware:get',
  getRecommendation: 'hardware:recommendation',
  listModels: 'models:list',
  downloadModels: 'models:download',
  cancelDownload: 'models:cancel',
  deleteModel: 'models:delete',
  openModelsFolder: 'models:open-folder',
  onModelState: 'models:state'
} as const
