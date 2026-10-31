import { useEffect, useState } from 'react'
import { CATALOG, SPEAKER_MODEL_IDS, type ModelEntry } from '../../../shared/catalog'
import { ENGINES, engineBytes, engineLabel } from '../../../shared/engines'
import ModelProgress from '../components/ModelProgress'
import SystemCard from '../components/SystemCard'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'

const VAD_ID = CATALOG.find((model) => model.kind === 'vad')?.id

const stepLabels = ['Welcome', 'System check', 'Choose models', 'Download']

export default function Onboarding() {
  const { models, hardware, recommendation, requiredEngines, download } = useModels()
  const { settings, update } = useSettings()
  const [step, setStep] = useState(0)
  const [transcription, setTranscription] = useState<string | null>(settings.transcriptionModel)
  const [llm, setLlm] = useState<string | null>(settings.llmModel)
  const [useVad, setUseVad] = useState(true)
  const [speakers, setSpeakers] = useState(false)

  useEffect(() => {
    if (!recommendation) return
    setTranscription((current) => current ?? recommendation.transcription)
    setLlm((current) => current ?? recommendation.llm)
  }, [recommendation])

  const engineEntries = requiredEngines
    ? ENGINES.filter((entry) => requiredEngines.ids.includes(entry.id))
    : []
  const engineBytesTotal = engineEntries.reduce((sum, entry) => sum + engineBytes(entry), 0)

  const selectedModelIds = (): string[] => {
    const ids: string[] = []
    if (transcription) ids.push(transcription)
    if (llm) ids.push(llm)
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
  }, [step, requiredEngines])

  const transcriptionModels = CATALOG.filter((model) => model.kind === 'transcription')
  const llmModels = CATALOG.filter((model) => model.kind === 'llm')
  const speakerBytes = CATALOG.filter((model) => model.kind === 'diarization').reduce(
    (sum, model) => sum + model.bytes,
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
    )
  const allInstalled =
    engineEntries.length + selectedEntries.length > 0 &&
    engineEntries.every((entry) => models[entry.id]?.status === 'installed') &&
    selectedEntries.every((entry) => models[entry.id]?.status === 'installed')

  const tooBig = (entry: ModelEntry): boolean =>
    hardware ? entry.memoryBytes > hardware.memoryBudgetBytes : false

  const finish = (): void => {
    update({ onboarded: true, transcriptionModel: transcription, llmModel: llm, useVad })
  }

  const skip = (): void => {
    update({ onboarded: true })
  }

  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-head">
          <div className="brand">
            Viral Clip <span>Finder</span>
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
                Viral Clip Finder runs entirely on this machine. Your videos and transcripts are
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
              <h2>Engines</h2>
              <div className="choice-list">
                <div className="choice selected">
                  <span className="choice-text">
                    <strong>
                      Engines
                      {hardware && hardware.backend !== 'cpu' ? ' (GPU accelerated)' : ''}
                    </strong>
                    <span>
                      {formatBytes(engineBytesTotal)} · Required to run transcription and clip
                      finding.
                    </span>
                  </span>
                </div>
              </div>
            </section>

            <section className="card">
              <h2>Transcription</h2>
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
                      onChange={() => setTranscription(entry.id)}
                    />
                    <span className="choice-text">
                      <strong>
                        {entry.name}
                        {recommendation?.transcription === entry.id ? (
                          <span className="badge">Recommended</span>
                        ) : null}
                      </strong>
                      <span>
                        {entry.description} · {formatBytes(entry.bytes)}
                        {tooBig(entry) ? (
                          <span className="choice-warning"> · May not fit your GPU/RAM</span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="card">
              <h2>Clip finder AI</h2>
              <div className="choice-list">
                {llmModels.map((entry) => (
                  <label key={entry.id} className={llm === entry.id ? 'choice selected' : 'choice'}>
                    <input
                      type="radio"
                      name="onboarding-llm"
                      checked={llm === entry.id}
                      onChange={() => setLlm(entry.id)}
                    />
                    <span className="choice-text">
                      <strong>
                        {entry.name}
                        {recommendation?.llm === entry.id ? (
                          <span className="badge">Recommended</span>
                        ) : null}
                      </strong>
                      <span>
                        {entry.description} · {formatBytes(entry.bytes)}
                        {tooBig(entry) ? (
                          <span className="choice-warning"> · May not fit your GPU/RAM</span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

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
                    <strong>Voice detection (recommended)</strong>
                    <span>Skips silence and music so Whisper does not invent words.</span>
                  </span>
                </label>
                <label className={speakers ? 'choice selected' : 'choice'}>
                  <input
                    type="checkbox"
                    checked={speakers}
                    onChange={(event) => setSpeakers(event.target.checked)}
                  />
                  <span className="choice-text">
                    <strong>Speaker detection (colored captions per speaker)</strong>
                    <span>Adds {formatBytes(speakerBytes)} to the download.</span>
                  </span>
                </label>
              </div>
            </section>

            <p className="muted">Total download: {formatBytes(totalBytes)}</p>

            <div className="onboarding-actions">
              <button
                type="button"
                className="button primary"
                disabled={!transcription || !llm}
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
