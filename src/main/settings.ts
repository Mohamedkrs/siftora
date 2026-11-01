import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CATALOG } from '../shared/catalog'
import {
  COOKIES_BROWSERS,
  CAPTION_FONTS,
  DEFAULT_SETTINGS,
  MAX_SPEAKER_COLORS,
  PALETTES,
  type CustomModel,
  type EngineBackend,
  type Settings
} from '../shared/types'
import { log } from './logger'

let cache: Settings | null = null

const ENGINE_BACKENDS: EngineBackend[] = ['auto', 'cuda', 'metal', 'vulkan', 'cpu']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function colorOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function modelIdOr(value: unknown, kind: 'transcription' | 'llm', custom: CustomModel[]): string | null {
  if (typeof value !== 'string') return null
  if (CATALOG.some((m) => m.id === value && m.kind === kind)) return value
  if (custom.some((m) => m.id === value && m.kind === kind)) return value
  return null
}

function customModelsOr(value: unknown): CustomModel[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const models: CustomModel[] = []

  for (const item of value) {
    if (!isRecord(item)) continue
    const { id, kind, name, path, bytes } = item
    if (typeof id !== 'string' || !id.startsWith('custom-') || seen.has(id)) continue
    if (kind !== 'transcription' && kind !== 'llm') continue
    if (typeof name !== 'string' || name.length === 0) continue
    if (typeof path !== 'string' || path.length === 0) continue
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) continue
    seen.add(id)
    models.push({ id, kind, name, path, bytes })
  }

  return models
}

function shortStringOr(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function enginePathsOr(value: unknown): Settings['enginePaths'] {
  const out: Settings['enginePaths'] = {}
  if (!isRecord(value)) return out
  for (const key of ['llama', 'whisper', 'ffmpeg'] as const) {
    const path = shortStringOr(value[key], 1024)
    if (path) out[key] = path
  }
  return out
}

function linkedModelsOr(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const linked: Record<string, string> = {}
  for (const [id, path] of Object.entries(value)) {
    if (typeof path === 'string' && CATALOG.some((model) => model.id === id)) linked[id] = path
  }
  return linked
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function sanitize(input: unknown): Settings {
  const raw = isRecord(input) ? input : {}
  const subtitle = isRecord(raw.subtitle) ? raw.subtitle : {}
  const defaults = DEFAULT_SETTINGS
  const customModels = customModelsOr(raw.customModels)

  const minClipSeconds = clamp(numberOr(raw.minClipSeconds, defaults.minClipSeconds), 1, 3600)
  const maxClipSeconds = clamp(numberOr(raw.maxClipSeconds, defaults.maxClipSeconds), 1, 3600)

  return {
    outputDir: typeof raw.outputDir === 'string' ? raw.outputDir : defaults.outputDir,
    layout:
      raw.layout === 'blurred' || raw.layout === 'focused' ? raw.layout : defaults.layout,
    subtitle: {
      enabled: typeof subtitle.enabled === 'boolean' ? subtitle.enabled : defaults.subtitle.enabled,
      font: CAPTION_FONTS.some((f) => f.family === subtitle.font)
        ? (subtitle.font as string)
        : defaults.subtitle.font,
      sizePx: clamp(numberOr(subtitle.sizePx, defaults.subtitle.sizePx), 32, 120),
      color: colorOr(subtitle.color, defaults.subtitle.color),
      highlight:
        typeof subtitle.highlight === 'boolean' ? subtitle.highlight : defaults.subtitle.highlight,
      highlightColor: colorOr(subtitle.highlightColor, defaults.subtitle.highlightColor),
      outline: typeof subtitle.outline === 'boolean' ? subtitle.outline : defaults.subtitle.outline,
      outlineColor: colorOr(subtitle.outlineColor, defaults.subtitle.outlineColor),
      // Older settings stored top/middle/bottom; map them to a height.
      positionY: clamp(
        numberOr(
          subtitle.positionY,
          subtitle.position === 'top' ? 15 : subtitle.position === 'bottom' ? 72 : defaults.subtitle.positionY
        ),
        5,
        95
      ),
      uppercase:
        typeof subtitle.uppercase === 'boolean' ? subtitle.uppercase : defaults.subtitle.uppercase,
      speakerColors:
        typeof subtitle.speakerColors === 'boolean'
          ? subtitle.speakerColors
          : defaults.subtitle.speakerColors,
      speakerPalette:
        Array.isArray(subtitle.speakerPalette) && subtitle.speakerPalette.length > 0
          ? subtitle.speakerPalette
              .slice(0, MAX_SPEAKER_COLORS)
              .map((color, i) => colorOr(color, defaults.subtitle.speakerPalette[i] ?? '#FFFFFF'))
          : defaults.subtitle.speakerPalette,
      otherSpeakersColor: colorOr(subtitle.otherSpeakersColor, defaults.subtitle.otherSpeakersColor)
    },
    language:
      typeof raw.language === 'string' && raw.language.trim().length > 0
        ? raw.language.slice(0, 16)
        : defaults.language,
    minClipSeconds: Math.min(minClipSeconds, maxClipSeconds),
    maxClipSeconds,
    minScore: clamp(numberOr(raw.minScore, defaults.minScore), 0, 10),
    theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : defaults.theme,
    palette: PALETTES.find((p) => p.id === raw.palette)?.id ?? defaults.palette,
    onboarded: typeof raw.onboarded === 'boolean' ? raw.onboarded : defaults.onboarded,
    transcriptionModel: modelIdOr(raw.transcriptionModel, 'transcription', customModels),
    llmModel: modelIdOr(raw.llmModel, 'llm', customModels),
    useVad: typeof raw.useVad === 'boolean' ? raw.useVad : defaults.useVad,
    // Older settings used the speaker-colors switch for both.
    detectSpeakers:
      typeof raw.detectSpeakers === 'boolean'
        ? raw.detectSpeakers
        : subtitle.speakerColors === true,
    speakersWhen: raw.speakersWhen === 'clip' ? 'clip' : 'video',
    detectReactions: typeof raw.detectReactions === 'boolean' ? raw.detectReactions : defaults.detectReactions,
    engineBackend:
      ENGINE_BACKENDS.find((backend) => backend === raw.engineBackend) ?? defaults.engineBackend,
    customModels,
    linkedModels: linkedModelsOr(raw.linkedModels),
    enginePaths: enginePathsOr(raw.enginePaths),
    llmProvider: raw.llmProvider === 'ollama' ? 'ollama' : 'app',
    ollamaModel: shortStringOr(raw.ollamaModel),
    transcriptionProvider: raw.transcriptionProvider === 'openai-whisper' ? 'openai-whisper' : 'app',
    openaiWhisperPath: shortStringOr(raw.openaiWhisperPath, 1024),
    openaiWhisperModel: shortStringOr(raw.openaiWhisperModel),
    cookiesBrowser:
      raw.cookiesBrowser === 'file' ? 'file' : (COOKIES_BROWSERS.find((browser) => browser === raw.cookiesBrowser) ?? null)
  }
}

function save(next: Settings): void {
  const target = settingsPath()
  const tmp = `${target}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

  try {
    renameSync(tmp, target)
  } catch {
    rmSync(target, { force: true })
    renameSync(tmp, target)
  }
}

export function getSettings(): Settings {
  if (cache) return cache

  let loaded: Settings

  try {
    loaded = sanitize(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('settings', `Could not read settings, using defaults: ${String(err)}`)
    }
    loaded = sanitize(DEFAULT_SETTINGS)
  }

  cache = loaded
  return loaded
}

export function setSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  const raw = isRecord(patch) ? patch : {}
  const next = sanitize({
    ...current,
    ...raw,
    subtitle: {
      ...current.subtitle,
      ...(isRecord(raw.subtitle) ? raw.subtitle : {})
    }
  })

  save(next)
  cache = next
  return next
}
