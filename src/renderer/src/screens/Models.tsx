import { useEffect, useState } from 'react'
import { CATALOG, type ModelEntry } from '../../../shared/catalog'
import { ENGINES, engineBytes, engineLabel } from '../../../shared/engines'
import type { CustomModel, EngineOption, ModelState } from '../../../shared/types'
import EngineChoice from '../components/EngineChoice'
import ExistingModels from '../components/ExistingModels'
import ModelProgress from '../components/ModelProgress'
import SystemCard from '../components/SystemCard'
import SystemEngines from '../components/SystemEngines'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'

function emptyState(id: string): ModelState {
  return { id, status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null }
}

interface CardEntry {
  id: string
  bytes: number
  license: string
  name?: string
  description?: string
}

interface CardProps {
  entries: CardEntry[]
  states: ModelState[]
  title?: string
  description?: string
  recommended?: boolean
  warning?: boolean
  radioName?: string
  radio?: { checked: boolean; onChange: () => void }
  toggle?: { label: string; checked: boolean; onChange: (checked: boolean) => void }
  custom?: boolean
  onDownload: (ids: string[]) => void
  onCancel: (id: string) => void
  onDelete: (ids: string[]) => void
}

function ModelCard(props: CardProps) {
  const installed = props.states.every((state) => state.status === 'installed')
  const active = props.states.filter(
    (state) =>
      state.status === 'downloading' ||
      state.status === 'queued' ||
      state.status === 'verifying' ||
      state.status === 'extracting'
  )
  const installedIds = props.entries
    .filter((_, index) => props.states[index].status === 'installed')
    .map((entry) => entry.id)
  const missingIds = props.entries
    .filter((_, index) => props.states[index].status !== 'installed')
    .map((entry) => entry.id)
  const totalBytes = props.entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const licenses = Array.from(new Set(props.entries.map((entry) => entry.license))).join(', ')
  const title =
    props.title ?? props.entries.map((entry) => entry.name ?? entry.id).join(' + ')
  const description =
    props.description ?? props.entries.map((entry) => entry.description ?? '').join(' ')

  const { settings } = useSettings()
  // A catalog model can be satisfied by the user's own file (e.g. from Ollama); never delete it.
  const linkedFile = props.entries.map((entry) => settings.linkedModels[entry.id]).find(Boolean)

  const remove = (): void => {
    if (
      !props.custom &&
      !linkedFile &&
      !confirm('Delete this model? You can download it again later.')
    )
      return
    props.onDelete(installedIds)
  }

  return (
    <article className="model-card">
      <div className="model-head">
        <div>
          <h3>
            {title}
            {props.recommended ? <span className="badge">Recommended</span> : null}
            {linkedFile ? (
              <span className="badge badge-ok">On this computer</span>
            ) : missingIds.length === 0 && props.entries.length > 0 && !props.custom ? (
              <span className="badge badge-ok">Already downloaded</span>
            ) : null}
          </h3>
          {description ? <p className="model-desc">{description}</p> : null}
        </div>
        <div className="model-meta">
          <span>{formatBytes(totalBytes)}</span>
          <span>{licenses}</span>
        </div>
      </div>

      {props.warning ? <p className="model-warning">May not fit your GPU/RAM</p> : null}
      {linkedFile ? (
        <p className="muted" title={linkedFile}>
          Using your file — nothing to download.
        </p>
      ) : null}

      {props.states.map((state, index) => (
        <ModelProgress key={state.id} state={state} totalBytes={props.entries[index].bytes} />
      ))}

      <div className="model-actions">
        {missingIds.length > 0 && active.length === 0 ? (
          <button
            type="button"
            className="button primary"
            onClick={() => props.onDownload(missingIds)}
          >
            Download
          </button>
        ) : null}

        {active.length > 0 ? (
          <button
            type="button"
            className="button"
            onClick={() => active.forEach((state) => props.onCancel(state.id))}
          >
            Cancel
          </button>
        ) : null}

        {installedIds.length > 0 ? (
          <button type="button" className="button" onClick={remove}>
            {props.custom ? 'Remove' : linkedFile ? 'Stop using my file' : 'Delete'}
          </button>
        ) : null}

        {props.radio && props.radioName ? (
          <label className="model-radio">
            <input
              type="radio"
              name={props.radioName}
              checked={props.radio.checked}
              disabled={!installed}
              onChange={props.radio.onChange}
            />
            Use this
          </label>
        ) : null}

        {props.toggle ? (
          <label className="model-radio">
            <input
              type="checkbox"
              checked={props.toggle.checked}
              onChange={(event) => props.toggle?.onChange(event.target.checked)}
            />
            {props.toggle.label}
          </label>
        ) : null}
      </div>
    </article>
  )
}

export default function Models() {
  const { models, hardware, recommendation, requiredEngines, download, cancel, remove } = useModels()
  const { settings, update, refresh } = useSettings()
  const [engineOptions, setEngineOptions] = useState<EngineOption[] | null>(null)
  // Bumped when the user starts/stops using their own engines, so sizes are recomputed.
  const [enginesVersion, setEnginesVersion] = useState(0)

  useEffect(() => {
    let alive = true

    window.api
      .getEngineOptions()
      .then((options) => {
        if (alive) setEngineOptions(options)
      })
      .catch((err: unknown) => {
        window.api.log('error', `getEngineOptions failed: ${String(err)}`)
      })

    return () => {
      alive = false
    }
  }, [hardware, enginesVersion])

  const stateOf = (entry: { id: string }): ModelState => models[entry.id] ?? emptyState(entry.id)

  const recommendedBackend = engineOptions?.find((option) => option.recommended)?.backend
  const chosenBackend =
    settings.engineBackend === 'auto' ? recommendedBackend : settings.engineBackend
  const selectedOption =
    engineOptions?.find((option) => option.backend === chosenBackend && option.available) ??
    engineOptions?.find((option) => option.recommended && option.available) ??
    engineOptions?.[0]
  const engineBackend = selectedOption?.backend ?? 'cpu'

  const engineEntries = selectedOption
    ? ENGINES.filter((entry) => selectedOption.ids.includes(entry.id))
    : []
  const otherInstalled = ENGINES.filter(
    (entry) =>
      !selectedOption?.ids.includes(entry.id) && models[entry.id]?.status === 'installed'
  )

  const customState = (model: CustomModel): ModelState =>
    models[model.id] ?? {
      id: model.id,
      status: 'installed',
      receivedBytes: model.bytes,
      bytesPerSec: 0,
      etaSec: null
    }

  const removeCustom = (ids: string[]): void => {
    ids.forEach((id) => {
      window.api
        .removeCustomModel(id)
        .then(() => refresh())
        .catch((err: unknown) => {
          window.api.log('error', `removeCustomModel failed: ${String(err)}`)
        })
    })
  }

  const transcriptionModels = CATALOG.filter((m) => m.kind === 'transcription')
  const llmModels = CATALOG.filter((m) => m.kind === 'llm')
  const vadModels = CATALOG.filter((m) => m.kind === 'vad')
  const speakerModels = CATALOG.filter((m) => m.kind === 'diarization')

  const tooBig = (entries: ModelEntry[]): boolean => {
    if (!hardware) return false
    return entries.reduce((sum, entry) => sum + entry.memoryBytes, 0) > hardware.memoryBudgetBytes
  }

  const removeMany = (ids: string[]): void => {
    ids.forEach((id) => {
      remove(id)
      if (settings.transcriptionModel === id) update({ transcriptionModel: null })
      if (settings.llmModel === id) update({ llmModel: null })
    })
  }

  const openFolder = (): void => {
    window.api.openModelsFolder().catch((err: unknown) => {
      window.api.log('error', `openModelsFolder failed: ${String(err)}`)
    })
  }

  return (
    <div className="screen">
      <div className="screen-head screen-head-row">
        <div>
          <h1>Models</h1>
          <p>Install and manage the models used for transcription and analysis.</p>
        </div>
        <button type="button" className="button" onClick={openFolder}>
          Open models folder
        </button>
      </div>

      <SystemCard />

      <section className="models-section">
        <h2>Engines</h2>
        <p className="label">Already on this computer</p>
        <SystemEngines autoScan={false} onChange={() => setEnginesVersion((v) => v + 1)} />
        <p className="label">Engine type</p>
        {engineOptions ? (
          <EngineChoice
            options={engineOptions}
            value={engineBackend}
            onChange={(backend) => update({ engineBackend: backend })}
          />
        ) : (
          <div className="loading-row" role="status">
            <span className="spinner" aria-hidden="true" />
            Checking available engines…
          </div>
        )}
        {requiredEngines?.missing.map((name) => (
          <p key={name} className="model-warning">
            No ready-made {name} build for this system yet.
          </p>
        ))}
        {engineEntries.map((entry) => (
          <ModelCard
            key={entry.id}
            entries={[
              {
                id: entry.id,
                bytes: engineBytes(entry),
                license: entry.license,
                description:
                  entry.backend === 'cuda'
                    ? 'Includes NVIDIA CUDA runtime — runs on the GPU, much faster than CPU.'
                    : undefined
              }
            ]}
            states={[stateOf(entry)]}
            title={engineLabel(entry)}
            onDownload={download}
            onCancel={cancel}
            onDelete={removeMany}
          />
        ))}
        {otherInstalled.length > 0 ? (
          <>
            <h3>Other installed engines</h3>
            {otherInstalled.map((entry) => (
              <ModelCard
                key={entry.id}
                entries={[
                  {
                    id: entry.id,
                    bytes: engineBytes(entry),
                    license: entry.license,
                    description: 'Installed engine from another choice.'
                  }
                ]}
                states={[stateOf(entry)]}
                title={engineLabel(entry)}
                onDownload={download}
                onCancel={cancel}
                onDelete={removeMany}
              />
            ))}
          </>
        ) : null}
      </section>

      <section className="models-section">
        <h2>Models already on this computer</h2>
        <ExistingModels />
      </section>

      <section className="models-section">
        <h2>Transcription</h2>
        {transcriptionModels.map((entry) => (
          <ModelCard
            key={entry.id}
            entries={[entry]}
            states={[stateOf(entry)]}
            recommended={recommendation?.transcription === entry.id}
            warning={tooBig([entry])}
            radioName="transcription-model"
            radio={{
              checked: settings.transcriptionModel === entry.id,
              onChange: () => update({ transcriptionModel: entry.id })
            }}
            onDownload={download}
            onCancel={cancel}
            onDelete={removeMany}
          />
        ))}
        {settings.customModels
          .filter((model) => model.kind === 'transcription')
          .map((model) => (
            <ModelCard
              key={model.id}
              entries={[
                {
                  id: model.id,
                  bytes: model.bytes,
                  license: 'Your file',
                  name: `${model.name} — your file`,
                  description: 'Custom models are not tested; results may vary.'
                }
              ]}
              states={[customState(model)]}
              radioName="transcription-model"
              radio={{
                checked: settings.transcriptionModel === model.id,
                onChange: () => update({ transcriptionModel: model.id })
              }}
              onDownload={download}
              onCancel={cancel}
              onDelete={removeCustom}
              custom
            />
          ))}
      </section>

      <section className="models-section">
        <h2>Clip finder AI</h2>
        {llmModels.map((entry) => (
          <ModelCard
            key={entry.id}
            entries={[entry]}
            states={[stateOf(entry)]}
            recommended={recommendation?.llm === entry.id}
            warning={tooBig([entry])}
            radioName="llm-model"
            radio={{
              checked: settings.llmModel === entry.id,
              onChange: () => update({ llmModel: entry.id })
            }}
            onDownload={download}
            onCancel={cancel}
            onDelete={removeMany}
          />
        ))}
        {settings.customModels
          .filter((model) => model.kind === 'llm')
          .map((model) => (
            <ModelCard
              key={model.id}
              entries={[
                {
                  id: model.id,
                  bytes: model.bytes,
                  license: 'Your file',
                  name: `${model.name} — your file`,
                  description: 'Custom models are not tested; results may vary.'
                }
              ]}
              states={[customState(model)]}
              radioName="llm-model"
              radio={{
                checked: settings.llmModel === model.id,
                onChange: () => update({ llmModel: model.id })
              }}
              onDownload={download}
              onCancel={cancel}
              onDelete={removeCustom}
              custom
            />
          ))}
      </section>

      <section className="models-section">
        <h2>Voice detection</h2>
        {vadModels.map((entry) => (
          <ModelCard
            key={entry.id}
            entries={[entry]}
            states={[stateOf(entry)]}
            warning={tooBig([entry])}
            toggle={{
              label: 'Use voice detection',
              checked: settings.useVad,
              onChange: (useVad) => update({ useVad })
            }}
            onDownload={download}
            onCancel={cancel}
            onDelete={removeMany}
          />
        ))}
      </section>

      <section className="models-section">
        <h2>Speaker detection</h2>
        <ModelCard
          entries={speakerModels}
          states={speakerModels.map(stateOf)}
          title="Speaker detection"
          description="Tells speakers apart so each gets its own caption color."
          warning={tooBig(speakerModels)}
          toggle={{
            label: 'Color captions per speaker',
            checked: settings.subtitle.speakerColors,
            onChange: (speakerColors) => update({ subtitle: { ...settings.subtitle, speakerColors } })
          }}
          onDownload={download}
          onCancel={cancel}
          onDelete={removeMany}
        />
      </section>
    </div>
  )
}
