export type Layout = 'blurred' | 'focused'

export interface SubtitleStyle {
  font: string
  sizePx: number
  color: string
  highlightColor: string
  outlineColor: string
  position: 'bottom' | 'middle' | 'top'
  uppercase: boolean
}

export interface Settings {
  outputDir: string
  layout: Layout
  subtitle: SubtitleStyle
  language: 'auto' | string
  maxClipSeconds: number
  minClipSeconds: number
  minScore: number
}

export const DEFAULT_SETTINGS: Settings = {
  outputDir: '',
  layout: 'blurred',
  subtitle: {
    font: 'Montserrat',
    sizePx: 72,
    color: '#FFFFFF',
    highlightColor: '#FFD400',
    outlineColor: '#000000',
    position: 'middle',
    uppercase: true
  },
  language: 'auto',
  maxClipSeconds: 60,
  minClipSeconds: 15,
  minScore: 6
}

export interface Api {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  pickOutputDir(): Promise<string | null>
  pickVideos(): Promise<string[]>
  log(level: 'info' | 'warn' | 'error', msg: string): void
  appInfo(): Promise<{ version: string; platform: string; userData: string }>
  getPathForFile(file: File): string
}

export const IPC = {
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  pickOutputDir: 'dialog:pick-output-dir',
  pickVideos: 'dialog:pick-videos',
  log: 'app:log',
  appInfo: 'app:info'
} as const
