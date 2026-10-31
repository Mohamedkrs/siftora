import { useEffect, useState } from 'react'
import type {
  EngineKind,
  OllamaInfo,
  OpenAiWhisperInfo,
  ScannedModel,
  Settings,
  SystemEngine
} from '../../../shared/types'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'

// ── Shared search state: one search fills every section, kept for the session. ──

interface ScanResult {
  engines: SystemEngine[]
  ollama: OllamaInfo
  pyWhisper: OpenAiWhisperInfo
  /** Model files (LM Studio, Hugging Face, …). Ollama's own blobs are covered by `ollama`. */
  files: ScannedModel[]
}

let result: ScanResult | null = null
let scanning = false
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((listener) => listener())

export async function searchComputer(): Promise<void> {
  if (scanning) return
  scanning = true
  notify()
  try {
    const [engines, ollama, pyWhisper, files] = await Promise.all([
      window.api.findSystemEngines(true),
      window.api.detectOllama(),
      window.api.detectOpenAiWhisper(),
      window.api.scanForModels()
    ])
    result = { engines, ollama, pyWhisper, files: files.filter((file) => file.source !== 'Ollama') }
  } catch (err) {
    window.api.log('error', `search computer failed: ${String(err)}`)
  } finally {
    scanning = false
    notify()
  }
}

export function useComputerSearch(): { result: ScanResult | null; scanning: boolean } {
  const [, rerender] = useState(0)
  useEffect(() => {
    const listener = (): void => rerender((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return { result, scanning }
}

// ── Helpers ──

const NAMES: Record<EngineKind, string> = { llama: 'llama.cpp', whisper: 'whisper.cpp', ffmpeg: 'FFmpeg' }
const PROGRAMS: Record<EngineKind, string> = { llama: 'llama-server', whisper: 'whisper-cli', ffmpeg: 'ffmpeg' }

function shortPath(path: string): string {
  return path.length > 60 ? `…${path.slice(-57)}` : path
}

function FoundBadge() {
  return <span className="badge badge-ok">Found on this computer</span>
}

/** Saves settings and waits for the main process, then lets the parent recompute sizes. */
function useSaver(onChange?: () => void) {
  const { refresh } = useSettings()
  return async (patch: Partial<Settings>): Promise<void> => {
    await window.api.setSettings(patch)
    await refresh()
    onChange?.()
  }
}

function Row(props: {
  selected: boolean
  title: React.ReactNode
  lines: React.ReactNode[]
  action?: React.ReactNode
}) {
  return (
    <div className={props.selected ? 'choice selected found-row' : 'choice found-row'}>
      <span className="choice-text">
        <strong>{props.title}</strong>
        {props.lines.filter(Boolean).map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </span>
      {props.action}
    </div>
  )
}

/** Adds a model file the user already has (link or custom entry). */
function useAddModelFile() {
  const { refresh } = useSettings()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const add = async (path: string, name?: string): Promise<boolean> => {
    setBusy(path)
    setError(null)
    try {
      const outcome = await window.api.addCustomModel(path, name)
      if (outcome.error) {
        setError(outcome.error)
        return false
      }
      if (result) result = { ...result, files: result.files.filter((file) => file.path !== path) }
      await refresh()
      notify()
      return true
    } finally {
      setBusy(null)
    }
  }
  const choose = async (): Promise<void> => {
    const path = await window.api.pickModelFile()
    if (path) await add(path)
  }
  return { add, choose, busy, error }
}

// ── Engines section ──

export function FoundEngines(props: { onChange?: () => void; autoPickFfmpeg?: boolean }) {
  const { settings, refresh } = useSettings()
  const { hardware } = useModels()
  const { result: found } = useComputerSearch()
  const [problem, setProblem] = useState<string | null>(null)

  const use = async (engine: EngineKind, path: string): Promise<void> => {
    const outcome = await window.api.useSystemEngine(engine, path)
    setProblem(outcome.ok ? null : `${NAMES[engine]}: ${outcome.problem ?? 'not usable'}`)
    if (outcome.ok) {
      await refresh()
      props.onChange?.()
    }
  }
  const stop = async (engine: EngineKind): Promise<void> => {
    await window.api.stopUsingSystemEngine(engine)
    await refresh()
    props.onChange?.()
  }
  const choose = async (engine: EngineKind): Promise<void> => {
    const path = await window.api.pickEngineBinary(engine)
    if (path) await use(engine, path)
  }

  // Onboarding: a working FFmpeg is as good as ours, so use it without asking.
  useEffect(() => {
    if (!props.autoPickFfmpeg || !found || settings.enginePaths.ffmpeg) return
    const ffmpeg = found.engines.find((engine) => engine.engine === 'ffmpeg' && engine.usable)
    if (ffmpeg) void use('ffmpeg', ffmpeg.path)
  }, [found])

  const gpuMachine = hardware !== null && hardware.backend !== 'cpu'
  // Show what is in use even before (or without) a search.
  const chosenOnly = (Object.keys(settings.enginePaths) as EngineKind[]).filter(
    (engine) => !found?.engines.some((item) => item.path === settings.enginePaths[engine])
  )

  return (
    <div className="found-list">
      {chosenOnly.map((engine) => (
        <Row
          key={engine}
          selected
          title={<>{NAMES[engine]} <span className="badge badge-ok">Your program</span></>}
          lines={[<span title={settings.enginePaths[engine]}>{shortPath(settings.enginePaths[engine] ?? '')}</span>]}
          action={
            <button type="button" className="button" onClick={() => void stop(engine)}>
              Stop using
            </button>
          }
        />
      ))}

      {found?.engines.map((engine) => {
        const inUse = settings.enginePaths[engine.engine] === engine.path
        return (
          <Row
            key={engine.path}
            selected={inUse}
            title={
              <>
                {NAMES[engine.engine]} {engine.version ?? ''}
                {engine.backend !== 'unknown' ? <span className="badge">{engine.backend.toUpperCase()}</span> : null}
                <FoundBadge />
              </>
            }
            lines={[
              <span title={engine.path}>
                {shortPath(engine.path)} ({engine.source}){engine.note ? ` · ${engine.note}` : ''}
              </span>,
              engine.problem ? <span className="model-warning">{engine.problem}</span> : null,
              inUse && engine.engine !== 'ffmpeg' && engine.backend === 'cpu' && gpuMachine ? (
                <span className="model-warning">
                  This build does not use your GPU — the app's GPU engines would be much faster.
                </span>
              ) : null
            ]}
            action={
              engine.usable ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => void (inUse ? stop(engine.engine) : use(engine.engine, engine.path))}
                >
                  {inUse ? 'Stop using' : 'Use this'}
                </button>
              ) : undefined
            }
          />
        )
      })}

      <div className="actions">
        {(Object.keys(PROGRAMS) as EngineKind[]).map((engine) => (
          <button key={engine} type="button" className="button small" onClick={() => void choose(engine)}>
            Choose {PROGRAMS[engine]}…
          </button>
        ))}
      </div>
      {problem ? <p className="model-warning">{problem}</p> : null}
    </div>
  )
}

// ── Transcription section ──

export function FoundTranscription(props: { onChange?: () => void }) {
  const { settings } = useSettings()
  const { result: found } = useComputerSearch()
  const save = useSaver(props.onChange)
  const files = useAddModelFile()
  const py = found?.pyWhisper
  const usingPy = settings.transcriptionProvider === 'openai-whisper'

  return (
    <div className="found-list">
      {py?.path
        ? py.models.map((model) => {
            const inUse = usingPy && settings.openaiWhisperModel === model
            return (
              <Row
                key={model}
                selected={inUse}
                title={
                  <>
                    Whisper {model} — OpenAI Whisper (Python) {py.version ?? ''}
                    {py.cuda !== null ? <span className="badge">{py.cuda ? 'GPU' : 'CPU only'}</span> : null}
                    <FoundBadge />
                  </>
                }
                lines={['Uses your existing Python setup. Slower than the app’s engine, same accuracy.']}
                action={
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void save(
                        inUse
                          ? { transcriptionProvider: 'app' }
                          : { transcriptionProvider: 'openai-whisper', openaiWhisperPath: py.path, openaiWhisperModel: model }
                      )
                    }
                  >
                    {inUse ? 'Stop using' : 'Use this'}
                  </button>
                }
              />
            )
          })
        : null}

      {found?.files
        .filter((file) => file.kind === 'transcription')
        .map((file) => (
          <Row
            key={file.path}
            selected={false}
            title={<>{file.name} <FoundBadge /></>}
            lines={[`${file.source} · ${formatBytes(file.bytes)}`]}
            action={
              <button type="button" className="button" disabled={files.busy !== null} onClick={() => void files.add(file.path, file.name)}>
                {files.busy === file.path ? 'Adding…' : 'Use this'}
              </button>
            }
          />
        ))}

      <div className="actions">
        <button type="button" className="button small" onClick={() => void files.choose()}>
          Choose a whisper.cpp model file…
        </button>
      </div>
      {files.error ? <p className="error">{files.error}</p> : null}
    </div>
  )
}

// ── Clip finder AI section ──

export function FoundLlms(props: { onChange?: () => void }) {
  const { settings } = useSettings()
  const { result: found } = useComputerSearch()
  const save = useSaver(props.onChange)
  const files = useAddModelFile()
  const ollama = found?.ollama

  return (
    <div className="found-list">
      {ollama?.installed && !ollama.running ? (
        <p className="muted">Ollama is installed but not running — start it to use its models.</p>
      ) : null}

      {ollama?.models.map((model) => {
        const inUse = settings.llmProvider === 'ollama' && settings.ollamaModel === model.name
        return (
          <Row
            key={model.name}
            selected={inUse}
            title={<>{model.name} (Ollama) <FoundBadge /></>}
            lines={[
              `${formatBytes(model.bytes)}${model.quantization ? ` · ${model.quantization}` : ''} · runs through your Ollama, nothing to download`
            ]}
            action={
              <button
                type="button"
                className="button"
                onClick={() =>
                  void save(inUse ? { llmProvider: 'app' } : { llmProvider: 'ollama', ollamaModel: model.name })
                }
              >
                {inUse ? 'Stop using' : 'Use this'}
              </button>
            }
          />
        )
      })}

      {found?.files
        .filter((file) => file.kind === 'llm')
        .map((file) => (
          <Row
            key={file.path}
            selected={false}
            title={<>{file.name} <FoundBadge /></>}
            lines={[`${file.source} · ${formatBytes(file.bytes)}`]}
            action={
              <button type="button" className="button" disabled={files.busy !== null} onClick={() => void files.add(file.path, file.name)}>
                {files.busy === file.path ? 'Adding…' : 'Use this'}
              </button>
            }
          />
        ))}

      <div className="actions">
        <button type="button" className="button small" onClick={() => void files.choose()}>
          Choose a .gguf model file…
        </button>
      </div>
      {files.error ? <p className="error">{files.error}</p> : null}
    </div>
  )
}

// ── Search button ──

export function SearchComputerButton(props: { auto?: boolean }) {
  const { result: found, scanning } = useComputerSearch()
  useEffect(() => {
    if (props.auto && !found) void searchComputer()
  }, [])
  return (
    <div className="actions">
      <button type="button" className="button" disabled={scanning} onClick={() => void searchComputer()}>
        {scanning ? 'Searching…' : found ? 'Search this computer again' : 'Search this computer'}
      </button>
      <span className="muted">
        {scanning
          ? 'Looking for Ollama, Python Whisper, FFmpeg, llama.cpp, whisper.cpp and model files…'
          : found
            ? 'Results are shown in each section below, marked “Found on this computer”.'
            : 'Find models and programs you already have, so you download less.'}
      </span>
    </div>
  )
}
