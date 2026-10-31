import { useEffect, useState } from 'react'
import type {
  EngineKind,
  OllamaInfo,
  OpenAiWhisperInfo,
  Settings,
  SystemEngine
} from '../../../shared/types'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'

const NAMES: Record<EngineKind, string> = { llama: 'llama.cpp', whisper: 'whisper.cpp', ffmpeg: 'FFmpeg' }
const PROGRAMS: Record<EngineKind, string> = { llama: 'llama-server', whisper: 'whisper-cli', ffmpeg: 'ffmpeg' }
const FFMPEG_BYTES = 194 * 1024 * 1024

// Last scan, kept for the session so revisiting a screen does not search again.
let lastScan: { engines: SystemEngine[]; ollama: OllamaInfo; pyWhisper: OpenAiWhisperInfo } | null = null

function shortPath(path: string): string {
  return path.length > 60 ? `…${path.slice(-57)}` : path
}

/** Pick the Ollama model closest to the recommended catalog model, else the largest that fits. */
function defaultOllamaModel(info: OllamaInfo, recommendedId: string | undefined, budget: number): string | null {
  const wanted = recommendedId?.replace(/-(\d+(\.\d+)?b)$/i, ':$1').toLowerCase()
  const exact = info.models.find((model) => model.name.toLowerCase().startsWith(wanted ?? '\0'))
  if (exact) return exact.name
  const fitting = info.models.filter((model) => model.bytes * 1.2 <= budget).sort((a, b) => b.bytes - a.bytes)
  return fitting[0]?.name ?? info.models[0]?.name ?? null
}

/**
 * Engines already on the computer: llama-server / whisper-cli / FFmpeg binaries, Ollama and
 * OpenAI Whisper (Python). Using them means less (or nothing) to download.
 */
export default function SystemEngines(props: {
  autoPickFfmpeg?: boolean
  /** Search on mount when there is no earlier result (onboarding). Models screen: manual. */
  autoScan?: boolean
  onChange?: () => void
}) {
  const { settings, refresh } = useSettings()
  const { hardware, recommendation } = useModels()
  const [engines, setEngines] = useState<SystemEngine[] | null>(lastScan?.engines ?? null)
  const [ollama, setOllama] = useState<OllamaInfo | null>(lastScan?.ollama ?? null)
  const [pyWhisper, setPyWhisper] = useState<OpenAiWhisperInfo | null>(lastScan?.pyWhisper ?? null)
  const [scanning, setScanning] = useState(false)
  const [problems, setProblems] = useState<Partial<Record<EngineKind, string>>>({})

  const scan = async (force = false): Promise<void> => {
    setScanning(true)
    try {
      const [found, ollamaInfo, whisperInfo] = await Promise.all([
        window.api.findSystemEngines(force),
        window.api.detectOllama(),
        window.api.detectOpenAiWhisper()
      ])
      lastScan = { engines: found, ollama: ollamaInfo, pyWhisper: whisperInfo }
      setEngines(found)
      setOllama(ollamaInfo)
      setPyWhisper(whisperInfo)
    } catch (err) {
      window.api.log('error', `engine scan failed: ${String(err)}`)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    if (!lastScan && props.autoScan !== false) void scan()
  }, [])

  const use = async (engine: EngineKind, path: string): Promise<void> => {
    const result = await window.api.useSystemEngine(engine, path)
    setProblems((current) => ({ ...current, [engine]: result.ok ? undefined : result.problem }))
    if (result.ok) {
      await refresh() // the main process saved it
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

  // Awaited (unlike update()) so engine sizes are recomputed after the main process has it.
  const setProvider = async (patch: Partial<Settings>): Promise<void> => {
    await window.api.setSettings(patch)
    await refresh()
    props.onChange?.()
  }

  // Onboarding: a working FFmpeg is the same as ours, so use it without asking.
  useEffect(() => {
    if (!props.autoPickFfmpeg || !engines || settings.enginePaths.ffmpeg) return
    const ffmpeg = engines.find((engine) => engine.engine === 'ffmpeg' && engine.usable)
    if (ffmpeg) void use('ffmpeg', ffmpeg.path)
  }, [engines])

  const gpuMachine = hardware !== null && hardware.backend !== 'cpu'

  if (scanning) {
    return (
      <div className="loading-row" role="status">
        <span className="spinner" aria-hidden="true" />
        Looking for engines already on this computer…
      </div>
    )
  }

  if (!engines) {
    // Not searched yet: show what is in use from settings, search only on request.
    const inUse = [
      ...(Object.keys(settings.enginePaths) as EngineKind[]).map(
        (engine) => `${NAMES[engine]}: ${shortPath(settings.enginePaths[engine] ?? '')}`
      ),
      ...(settings.llmProvider === 'ollama' ? [`Clip finding: Ollama (${settings.ollamaModel ?? '?'})`] : []),
      ...(settings.transcriptionProvider === 'openai-whisper'
        ? [`Transcription: OpenAI Whisper (${settings.openaiWhisperModel ?? '?'})`]
        : [])
    ]
    return (
      <div className="system-engines">
        {inUse.length > 0 ? (
          <ul className="reasons">
            {inUse.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Not using any programs from this computer.</p>
        )}
        <div className="actions">
          <button type="button" className="button" onClick={() => void scan(true)}>
            Search this computer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="system-engines">
      {engines.length === 0 ? <p className="muted">No llama.cpp, whisper.cpp or FFmpeg found.</p> : null}

      {engines.map((engine) => {
        const inUse = settings.enginePaths[engine.engine] === engine.path
        return (
          <div key={engine.path} className={inUse ? 'choice selected' : 'choice'}>
            <span className="choice-text">
              <strong>
                {NAMES[engine.engine]} {engine.version ?? ''}{' '}
                {engine.backend !== 'unknown' ? <span className="badge">{engine.backend.toUpperCase()}</span> : null}
              </strong>
              <span title={engine.path}>
                {shortPath(engine.path)} ({engine.source})
                {engine.note ? ` · ${engine.note}` : ''}
              </span>
              {engine.problem ? <span className="model-warning">{engine.problem}</span> : null}
              {inUse && engine.engine === 'ffmpeg' && props.autoPickFfmpeg ? (
                <span>Using your FFmpeg — saves {formatBytes(FFMPEG_BYTES)}.</span>
              ) : null}
              {inUse && engine.engine !== 'ffmpeg' && engine.backend === 'cpu' && gpuMachine ? (
                <span className="model-warning">
                  This build does not use your GPU — the app's GPU engines would be much faster.
                </span>
              ) : null}
            </span>
            {engine.usable ? (
              inUse ? (
                <button type="button" className="button" onClick={() => void stop(engine.engine)}>
                  Stop using
                </button>
              ) : (
                <button type="button" className="button" onClick={() => void use(engine.engine, engine.path)}>
                  Use this
                </button>
              )
            ) : null}
          </div>
        )
      })}

      {ollama?.installed ? (
        <div className={settings.llmProvider === 'ollama' ? 'choice selected' : 'choice'}>
          <span className="choice-text">
            <strong>
              Ollama {ollama.version ?? ''} — {ollama.running ? `running · ${ollama.models.length} models` : 'installed, not running'}
            </strong>
            {!ollama.running ? <span>Start Ollama to use it for clip finding.</span> : null}
            {settings.llmProvider === 'ollama' ? (
              <label className="field">
                Model for clip finding
                <select
                  value={settings.ollamaModel ?? ''}
                  onChange={(event) => void setProvider({ ollamaModel: event.target.value })}
                >
                  {ollama.models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name} ({formatBytes(model.bytes)}
                      {model.quantization ? `, ${model.quantization}` : ''})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>Same engine as llama.cpp inside — uses the models you already pulled.</span>
            )}
          </span>
          {settings.llmProvider === 'ollama' ? (
            <button type="button" className="button" onClick={() => void setProvider({ llmProvider: 'app' })}>
              Stop using
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={!ollama.running || ollama.models.length === 0}
              onClick={() =>
                void setProvider({
                  llmProvider: 'ollama',
                  ollamaModel:
                    settings.ollamaModel ??
                    defaultOllamaModel(ollama, recommendation?.llm, hardware?.memoryBudgetBytes ?? Infinity)
                })
              }
            >
              Use Ollama for clip finding
            </button>
          )}
        </div>
      ) : null}

      {pyWhisper?.path ? (
        <div className={settings.transcriptionProvider === 'openai-whisper' ? 'choice selected' : 'choice'}>
          <span className="choice-text">
            <strong>
              OpenAI Whisper (Python) {pyWhisper.version ?? ''}{' '}
              {pyWhisper.cuda === null ? null : (
                <span className="badge">{pyWhisper.cuda ? 'GPU' : 'CPU only'}</span>
              )}
            </strong>
            <span>
              Models: {pyWhisper.models.length > 0 ? pyWhisper.models.join(', ') : 'none downloaded yet'} ·
              slower than the app's engine but uses your existing setup.
            </span>
            {settings.transcriptionProvider === 'openai-whisper' ? (
              <label className="field">
                Model for transcription
                <select
                  value={settings.openaiWhisperModel ?? ''}
                  onChange={(event) => void setProvider({ openaiWhisperModel: event.target.value })}
                >
                  {Array.from(new Set([...pyWhisper.models, 'turbo', 'large-v3'])).map((model) => (
                    <option key={model} value={model}>
                      {model}
                      {pyWhisper.models.includes(model) ? '' : ' (Whisper downloads it on first use)'}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </span>
          {settings.transcriptionProvider === 'openai-whisper' ? (
            <button type="button" className="button" onClick={() => void setProvider({ transcriptionProvider: 'app' })}>
              Stop using
            </button>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() =>
                void setProvider({
                  transcriptionProvider: 'openai-whisper',
                  openaiWhisperPath: pyWhisper.path,
                  openaiWhisperModel:
                    settings.openaiWhisperModel ?? (pyWhisper.models.includes('large-v3') ? 'large-v3' : 'turbo')
                })
              }
            >
              Use it for transcription
            </button>
          )}
        </div>
      ) : null}

      <div className="actions">
        {(Object.keys(PROGRAMS) as EngineKind[]).map((engine) => (
          <button key={engine} type="button" className="button" onClick={() => void choose(engine)}>
            Choose {PROGRAMS[engine]}…
          </button>
        ))}
        <button type="button" className="button" onClick={() => void scan(true)}>
          Search again
        </button>
      </div>
      {(Object.keys(problems) as EngineKind[]).map((engine) =>
        problems[engine] ? (
          <p key={engine} className="model-warning">
            {NAMES[engine]}: {problems[engine]}
          </p>
        ) : null
      )}
    </div>
  )
}
