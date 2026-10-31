import { CATALOG, type ModelEntry } from '../../../shared/catalog'
import type { ModelState } from '../../../shared/types'
import ModelProgress from '../components/ModelProgress'
import SystemCard from '../components/SystemCard'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import { useSettings } from '../state/settings'

function emptyState(id: string): ModelState {
  return { id, status: 'missing', receivedBytes: 0, bytesPerSec: 0, etaSec: null }
}

interface CardProps {
  entries: ModelEntry[]
  states: ModelState[]
  title?: string
  description?: string
  recommended?: boolean
  warning?: boolean
  radioName?: string
  radio?: { checked: boolean; onChange: () => void }
  toggle?: { label: string; checked: boolean; onChange: (checked: boolean) => void }
  onDownload: (ids: string[]) => void
  onCancel: (id: string) => void
  onDelete: (ids: string[]) => void
}

function ModelCard(props: CardProps) {
  const installed = props.states.every((state) => state.status === 'installed')
  const active = props.states.filter(
    (state) =>
      state.status === 'downloading' || state.status === 'queued' || state.status === 'verifying'
  )
  const installedIds = props.entries
    .filter((_, index) => props.states[index].status === 'installed')
    .map((entry) => entry.id)
  const missingIds = props.entries
    .filter((_, index) => props.states[index].status !== 'installed')
    .map((entry) => entry.id)
  const totalBytes = props.entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const licenses = Array.from(new Set(props.entries.map((entry) => entry.license))).join(', ')

  const remove = (): void => {
    if (!confirm('Delete this model? You can download it again later.')) return
    props.onDelete(installedIds)
  }

  return (
    <article className="model-card">
      <div className="model-head">
        <div>
          <h3>
            {props.title ?? props.entries.map((entry) => entry.name).join(' + ')}
            {props.recommended ? <span className="badge">Recommended</span> : null}
          </h3>
          <p className="model-desc">
            {props.description ?? props.entries.map((entry) => entry.description).join(' ')}
          </p>
        </div>
        <div className="model-meta">
          <span>{formatBytes(totalBytes)}</span>
          <span>{licenses}</span>
        </div>
      </div>

      {props.warning ? <p className="model-warning">May not fit your GPU/RAM</p> : null}

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
            Delete
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
  const { models, hardware, recommendation, download, cancel, remove } = useModels()
  const { settings, update } = useSettings()

  const stateOf = (entry: ModelEntry): ModelState => models[entry.id] ?? emptyState(entry.id)

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
          onDownload={download}
          onCancel={cancel}
          onDelete={removeMany}
        />
      </section>
    </div>
  )
}
