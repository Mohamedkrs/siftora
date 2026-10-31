import { useEffect, useState } from 'react'
import { CATALOG, SPEAKER_MODEL_IDS, type ModelEntry } from '../../../shared/catalog'
import { ENGINES, engineBytes, engineLabel } from '../../../shared/engines'
import type { EngineOption, Settings } from '../../../shared/types'
import EngineChoice from '../components/EngineChoice'
import {
  copySource,
  FoundEngines,
  FoundLlms,
  FoundTranscription,
  SearchComputerButton,
  useLocalCopies
} from '../components/FoundOnComputer'
import ModelProgress from '../components/ModelProgress'
import SystemCard from '../components/SystemCard'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'
import logo from '../../../../resources/brand/siftora-horizontal-small-on-dark.svg'

const VAD_ID = CATALOG.find((model) => model.kind === 'vad')?.id

const stepLabels = ['Welcome', 'System check', 'Choose models', 'Download']

export default function Onboarding() {
  const { models, hardware, recommendation, download } = useModels()
  const { settings, update, refresh } = useSettings()
  const [step, setStep] = useState(0)
  const [transcription, setTranscription] = useState<string | null>(settings.transcriptionModel)
  const [llm, setLlm] = useState<string | null>(settings.llmModel)
  const [useVad, setUseVad] = useState(settings.useVad)
  const [speakers, setSpeakers] = useState(settings.detectSpeakers)
  const [engineOptions, setEngineOptions] = useState<EngineOption[] | null>(null)
  const [engineBackend, setEngineBackend] = useState(settings.engineBackend)
  const [enginesVersion, setEnginesVersion] = useState(0)
  const useOllama = settings.llmProvider === 'ollama'
  const switchToApp = async (patch: Partial<Settings>): Promise<void> => {
    await window.api.setSettings(patch)
    await refresh()
    setEnginesVersion((v) => v + 1)
  }
  const usePyWhisper = settings.transcriptionProvider === 'openai-whisper'

  useEffect(() => {
    let alive = true

    window.api
      .getEngineOptions()
      .then((options) => {
        if (!alive) return
        setEngineOptions(options)
        setEngineBackend((current) => {
          if (options.some((option) => option.backend === current && option.available)) return current
          return (
            options.find((option) => option.recommended && option.available)?.backend ??
            options[0]?.backend ??
            'cpu'
          )
        })
      })
      .catch((err: unknown) => {
        window.api.log('error', `getEngineOptions failed: ${String(err)}`)
      })

    return () => {
      alive = false
    }
  }, [hardware, enginesVersion])

  const copies = useLocalCopies(() => setEnginesVersion((v) => v + 1))

  /** Badge text when a catalog model needs no download: already here, or a copy was found. */
  const presence = (id: string): string | null => {
    if (settings.linkedModels[id]) return 'On this computer'
    if (models[id]?.status === 'installed') return 'Already downloaded'
    const copy = copies.copyFor(id)
    if (copy) return `Found in ${copySource(copy)}`
    return null
  }

  /** Size line: a found copy is used as is, so there is nothing to download. */
  const sizeNote = (id: string, bytes: number): string =>
    copies.copyFor(id) && !settings.linkedModels[id] ? 'nothing to download, uses that file' : formatBytes(bytes)

  useEffect(() => {
    if (!recommendation) return
    setTranscription((current) => current ?? recommendation.transcription)
    setLlm((current) => current ?? recommendation.llm)
  }, [recommendation])

  const engineOption = engineOptions?.find((option) => option.backend === engineBackend) ?? null
  const engineEntries = engineOption
    ? ENGINES.filter((entry) => engineOption.ids.includes(entry.id))
    : []

  const selectedModelIds = (): string[] => {
    const ids: string[] = []
    if (transcription && !usePyWhisper) ids.push(transcription)
    if (llm && !useOllama) ids.push(llm)
    if (useVad && VAD_ID) ids.push(VAD_ID)
    if (speakers) ids.push(...SPEAKER_MODEL_IDS)
    return ids
  }

  const selectedIds = (): string[] => [
    ...engineEntries.map((entry) => entry.id),
    ...selectedModelIds()
  ]

  useEffect(() => {
    if (step !== 3) return
    download(selectedIds())
  }, [step])

  const removeCustom = async (id: string): Promise<void> => {
    try {
      await window.api.removeCustomModel(id)
      setTranscription((current) =>
        current === id ? (recommendation?.transcription ?? null) : current
      )
      setLlm((current) => (current === id ? (recommendation?.llm ?? null) : current))
      await refresh()
    } catch (err) {
      window.api.log('error', `removeCustomModel failed: ${String(err)}`)
    }
  }

  const transcriptionModels = CATALOG.filter((model) => model.kind === 'transcription')
  const llmModels = CATALOG.filter((model) => model.kind === 'llm')
  const vadEntry = CATALOG.find((model) => model.id === VAD_ID)
  const vadInstalled = VAD_ID ? models[VAD_ID]?.status === 'installed' : false
  const sherpa = ENGINES.find(
    (entry) => entry.engine === 'sherpa' && entry.platform === hardware?.platform && entry.arch === hardware?.arch
  )
  const speakerParts = [
    ...SPEAKER_MODEL_IDS.map((id) => ({ id, bytes: CATALOG.find((model) => model.id === id)?.bytes ?? 0 })),
    ...(sherpa ? [{ id: sherpa.id, bytes: engineBytes(sherpa) }] : [])
  ]
  const speakerBytes = speakerParts.reduce((sum, part) => sum + part.bytes, 0)
  const speakersInstalled = speakerParts.every((part) => models[part.id]?.status === 'installed')
  const speakerMissingBytes = speakerParts.reduce(
    (sum, part) => sum + (models[part.id]?.status === 'installed' ? 0 : part.bytes),
    0
  )

  const selectedEntries = selectedModelIds().flatMap((id) => {
    const entry = CATALOG.find((model) => model.id === id)
    return entry ? [entry] : []
  })
  const totalBytes =
    engineEntries.reduce(
      (sum, entry) => sum + (models[entry.id]?.status === 'installed' ? 0 : engineBytes(entry)),
      0
    ) +
    selectedEntries.reduce(
      (sum, entry) => sum + (models[entry.id]?.status === 'installed' ? 0 : entry.bytes),
      0
    ) +
    // Speaker detection also needs its engine, sherpa-onnx.
    (speakers && sherpa && models[sherpa.id]?.status !== 'installed' ? engineBytes(sherpa) : 0)
  const allInstalled =
    engineEntries.length + selectedEntries.length > 0 &&
    engineEntries.every((entry) => models[entry.id]?.status === 'installed') &&
    selectedEntries.every((entry) => models[entry.id]?.status === 'installed')

  const tooBig = (entry: ModelEntry): boolean =>
    hardware ? entry.memoryBytes > hardware.memoryBudgetBytes : false

  const finish = (): void => {
    update({ onboarded: true, transcriptionModel: transcription, llmModel: llm, useVad, detectSpeakers: speakers })
  }

  const skip = (): void => {
    update({ onboarded: true })
  }

  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-head">
          <div className="brand">
            <img src={logo} alt="Siftora" />
          </div>
          <button type="button" className="onboarding-skip" onClick={skip}>
            Skip setup
          </button>
        </div>

        <div className="steps" aria-label={`Step ${step + 1} of ${stepLabels.length}`}>
          {stepLabels.map((label, index) => (
            <span
              key={label}
              className={index === step ? 'step active' : index < step ? 'step done' : 'step'}
            >
              {index + 1}. {label}
            </span>
          ))}
        </div>

        <h1>{stepLabels[step]}</h1>

        {step === 0 ? (
          <>
            <section className="card">
              <h2>Everything stays on your computer</h2>
              <p>
                Siftora runs entirely on this machine. Your videos and transcripts are
                never uploaded anywhere. Models are downloaded only when you choose them.
              </p>
            </section>
            <div className="onboarding-actions">
              <button type="button" className="button primary" onClick={() => setStep(1)}>
                Get started
              </button>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <SystemCard />
            <div className="onboarding-actions">
              <button type="button" className="button" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!hardware}
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <section className="card">
              <h2>Already on this computer</h2>
              <SearchComputerButton auto />
            </section>

            <section className="card">
              <h2>Engines</h2>
              <FoundEngines autoPickFfmpeg onChange={() => setEnginesVersion((v) => v + 1)} />
              {engineOptions ? (
                <EngineChoice
                  options={engineOptions}
                  value={engineBackend}
                  onChange={(backend) => {
                    setEngineBackend(backend)
                    update({ engineBackend: backend })
                  }}
                />
              ) : (
                <div className="loading-row" role="status">
                  <span className="spinner" aria-hidden="true" />
                  Checking available engines…
                </div>
              )}
            </section>

            {usePyWhisper ? (
              <section className="card">
                <h2>Transcription</h2>
                <p className="muted">
                  Using OpenAI Whisper (Python) with model {settings.openaiWhisperModel}.{' '}
                  <button type="button" className="link-button" onClick={() => void switchToApp({ transcriptionProvider: 'app' })}>
                    Use the app's models instead
                  </button>
                </p>
              </section>
            ) : (
              <>
            <section className="card">
              <h2>Transcription</h2>
              <FoundTranscription onChange={() => setEnginesVersion((v) => v + 1)} />
              <p className="label list-label">Built into Siftora · whisper.cpp</p>
              <div className="choice-list">
                {transcriptionModels.map((entry) => (
                  <label
                    key={entry.id}
                    className={transcription === entry.id ? 'choice selected' : 'choice'}
                  >
                    <input
                      type="radio"
                      name="onboarding-transcription"
                      checked={transcription === entry.id}
                      onChange={() => {
                        setTranscription(entry.id)
                        void copies.use(entry.id)
                      }}
                    />
                    <span className="choice-text">
                      <strong>
                        {entry.name}
                        {recommendation?.transcription === entry.id ? (
                          <span className="badge">Recommended</span>
                        ) : null}
                        {presence(entry.id) ? (
                          <span className="badge badge-ok">{presence(entry.id)}</span>
                        ) : null}
                      </strong>
                      <span>
                        {entry.description} · {sizeNote(entry.id, entry.bytes)}
                        {tooBig(entry) ? (
                          <span className="choice-warning"> · May not fit your GPU/RAM</span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))}
                {settings.customModels
                  .filter((model) => model.kind === 'transcription')
                  .map((model) => (
                    <label
                      key={model.id}
                      className={transcription === model.id ? 'choice selected' : 'choice'}
                    >
                      <input
                        type="radio"
                        name="onboarding-transcription"
                        checked={transcription === model.id}
                        onChange={() => setTranscription(model.id)}
                      />
                      <span className="choice-text">
                        <strong>{model.name} — your file</strong>
                        <span>
                          {formatBytes(model.bytes)} · Custom models are not tested; results may
                          vary.
                        </span>
                      </span>
                      <button
                        type="button"
                        className="remove-link"
                        onClick={(event) => {
                          event.preventDefault()
                          void removeCustom(model.id)
                        }}
                      >
                        Remove
                      </button>
                    </label>
                  ))}
              </div>
            </section>

              </>
            )}

            {useOllama ? (
              <section className="card">
                <h2>Clip finder AI</h2>
                <p className="muted">
                  Using Ollama with {settings.ollamaModel}.{' '}
                  <button type="button" className="link-button" onClick={() => void switchToApp({ llmProvider: 'app' })}>
                    Use the app's models instead
                  </button>
                </p>
              </section>
            ) : (
              <>
            <section className="card">
              <h2>Clip finder AI</h2>
              <FoundLlms onChange={() => setEnginesVersion((v) => v + 1)} />
              <p className="label list-label">Built into Siftora · llama.cpp</p>
              <div className="choice-list">
                {llmModels.map((entry) => (
                  <label key={entry.id} className={llm === entry.id ? 'choice selected' : 'choice'}>
                    <input
                      type="radio"
                      name="onboarding-llm"
                      checked={llm === entry.id}
                      onChange={() => {
                        setLlm(entry.id)
                        void copies.use(entry.id)
                      }}
                    />
                    <span className="choice-text">
                      <strong>
                        {entry.name}
                        {recommendation?.llm === entry.id ? (
                          <span className="badge">Recommended</span>
                        ) : null}
                        {presence(entry.id) ? (
                          <span className="badge badge-ok">{presence(entry.id)}</span>
                        ) : null}
                      </strong>
                      <span>
                        {entry.description} · {sizeNote(entry.id, entry.bytes)}
                        {tooBig(entry) ? (
                          <span className="choice-warning"> · May not fit your GPU/RAM</span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))}
                {settings.customModels
                  .filter((model) => model.kind === 'llm')
                  .map((model) => (
                    <label
                      key={model.id}
                      className={llm === model.id ? 'choice selected' : 'choice'}
                    >
                      <input
                        type="radio"
                        name="onboarding-llm"
                        checked={llm === model.id}
                        onChange={() => setLlm(model.id)}
                      />
                      <span className="choice-text">
                        <strong>{model.name} — your file</strong>
                        <span>
                          {formatBytes(model.bytes)} · Custom models are not tested; results may
                          vary.
                        </span>
                      </span>
                      <button
                        type="button"
                        className="remove-link"
                        onClick={(event) => {
                          event.preventDefault()
                          void removeCustom(model.id)
                        }}
                      >
                        Remove
                      </button>
                    </label>
                  ))}
              </div>
            </section>

              </>
            )}

            <section className="card">
              <h2>Extras</h2>
              <div className="choice-list">
                <label className={useVad ? 'choice selected' : 'choice'}>
                  <input
                    type="checkbox"
                    checked={useVad}
                    onChange={(event) => setUseVad(event.target.checked)}
                  />
                  <span className="choice-text">
                    <strong>
                      Voice detection (recommended)
                      {vadInstalled ? <span className="badge badge-ok">Already downloaded</span> : null}
                    </strong>
                    <span>
                      Finds the parts with speech before transcribing. Without it, Whisper can
                      invent captions during silence or music (e.g. "Thanks for watching!") and
                      repeat lines. {vadInstalled ? 'Nothing to download.' : `${formatBytes(vadEntry?.bytes ?? 0)}.`}
                    </span>
                  </span>
                </label>
                <label className={speakers ? 'choice selected' : 'choice'}>
                  <input
                    type="checkbox"
                    checked={speakers}
                    onChange={(event) => setSpeakers(event.target.checked)}
                  />
                  <span className="choice-text">
                    <strong>
                      Speaker detection (colored captions per speaker)
                      {speakersInstalled ? (
                        <span className="badge badge-ok">Already downloaded</span>
                      ) : null}
                    </strong>
                    <span>
                      Works out who is speaking when, so each speaker's captions can get their
                      own color. Optional; you can add it later.{' '}
                      {speakersInstalled
                        ? 'Nothing to download.'
                        : speakerMissingBytes < speakerBytes
                          ? `${formatBytes(speakerMissingBytes)} left to download.`
                          : `${formatBytes(speakerBytes)}, including the sherpa-onnx engine.`}
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <p className="muted">
              {totalBytes === 0
                ? 'Nothing to download — using what is already on this computer.'
                : `Total download: ${formatBytes(totalBytes)}`}
            </p>

            <div className="onboarding-actions">
              <button type="button" className="button" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!transcription || !llm || !engineOption}
                onClick={() => setStep(3)}
              >
                Download selected
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <section className="card">
              <h2>Downloading models</h2>
              {engineEntries.map((entry) => (
                <div className="download-row" key={entry.id}>
                  <strong>{engineLabel(entry)}</strong>
                  {models[entry.id] ? (
                    <ModelProgress state={models[entry.id]} totalBytes={engineBytes(entry)} />
                  ) : null}
                </div>
              ))}
              {selectedEntries.map((entry) => (
                <div className="download-row" key={entry.id}>
                  <strong>{entry.name}</strong>
                  {models[entry.id] ? (
                    <ModelProgress state={models[entry.id]} totalBytes={entry.bytes} />
                  ) : null}
                </div>
              ))}
            </section>

            <div className="onboarding-actions">
              <button type="button" className="button" onClick={() => setStep(2)}>
                Back
              </button>
              <button type="button" className="button" onClick={finish}>
                Continue in background
              </button>
              {allInstalled ? (
                <button type="button" className="button primary" onClick={finish}>
                  Start using the app
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
