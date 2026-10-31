import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { log } from './logger'

let cache: Settings | null = null

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

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function sanitize(input: unknown): Settings {
  const raw = isRecord(input) ? input : {}
  const subtitle = isRecord(raw.subtitle) ? raw.subtitle : {}
  const defaults = DEFAULT_SETTINGS

  const minClipSeconds = clamp(numberOr(raw.minClipSeconds, defaults.minClipSeconds), 1, 3600)
  const maxClipSeconds = clamp(numberOr(raw.maxClipSeconds, defaults.maxClipSeconds), 1, 3600)

  return {
    outputDir: typeof raw.outputDir === 'string' ? raw.outputDir : defaults.outputDir,
    layout:
      raw.layout === 'blurred' || raw.layout === 'focused' ? raw.layout : defaults.layout,
    subtitle: {
      font:
        typeof subtitle.font === 'string' && subtitle.font.trim().length > 0
          ? subtitle.font.slice(0, 64)
          : defaults.subtitle.font,
      sizePx: clamp(numberOr(subtitle.sizePx, defaults.subtitle.sizePx), 32, 120),
      color: colorOr(subtitle.color, defaults.subtitle.color),
      highlightColor: colorOr(subtitle.highlightColor, defaults.subtitle.highlightColor),
      outlineColor: colorOr(subtitle.outlineColor, defaults.subtitle.outlineColor),
      position:
        subtitle.position === 'top' || subtitle.position === 'middle' || subtitle.position === 'bottom'
          ? subtitle.position
          : defaults.subtitle.position,
      uppercase:
        typeof subtitle.uppercase === 'boolean' ? subtitle.uppercase : defaults.subtitle.uppercase
    },
    language:
      typeof raw.language === 'string' && raw.language.trim().length > 0
        ? raw.language.slice(0, 16)
        : defaults.language,
    minClipSeconds: Math.min(minClipSeconds, maxClipSeconds),
    maxClipSeconds,
    minScore: clamp(numberOr(raw.minScore, defaults.minScore), 0, 10)
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
