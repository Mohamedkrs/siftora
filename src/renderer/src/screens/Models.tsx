import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CATALOG, llamaTooOld, type ModelEntry } from '../../../shared/catalog'
import { ENGINES, engineBytes, engineLabel } from '../../../shared/engines'
import type { CustomModel, EngineOption, ModelState, ScannedModel } from '../../../shared/types'
import EngineChoice from '../components/EngineChoice'
import { useDialog } from '../components/Dialog'
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
import { useOwnLlamaBuild, useSettings } from '../state/settings'

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
  inUse?: boolean
  /** A copy of this model found on the computer, offered instead of the download. */
  localCopy?: { file: ScannedModel; busy: boolean; onUse: () => void }
  warning?: boolean
  /** Why this model cannot run here, e.g. the user's llama.cpp is too old. */
  problem?: string | null
  radioName?: string
  radio?: { checked: boolean; onChange: () => void }
  toggle?: { label: string; checked: boolean; onChange: (checked: boolean) => void }
  custom?: boolean
  onDownload: (ids: string[]) => void
  onCancel: (id: string) => void
  onDelete: (ids: string[]) => void
}

/** What each engine does, in plain words. */
const ENGINE_ROLES: Record<string, string> = {
  whisper: 'Runs the transcription model: turns speech into text with word timings.',
  llama: 'Runs the clip finder AI: reads the transcript and picks the moments.',
  ffmpeg: 'Cuts the clips and renders the vertical reels with captions.',
  sherpa: 'Runs the speaker detection models.'
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
  const updates = props.states.filter((state) => state.status === 'installed' && state.update)
  const totalBytes = props.entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const licenses = Array.from(new Set(props.entries.map((entry) => entry.license))).join(', ')
  const title =
    props.title ?? props.entries.map((entry) => entry.name ?? entry.id).join(' + ')
  const description =
    props.description ?? props.entries.map((entry) => entry.description ?? '').join(' ')

  const { settings } = useSettings()
  // A catalog model can be satisfied by the user's own file (e.g. from Ollama); never delete it.
  const linkedFile = props.entries.map((entry) => settings.linkedModels[entry.id]).find(Boolean)

  const dialog = useDialog()
  const remove = async (): Promise<void> => {
    if (
      !props.custom &&
      !linkedFile &&
      !(await dialog.confirm({
        title: `Delete ${title}?`,
        message: `Frees ${formatBytes(totalBytes)}. You can download it again later.`,
        confirmLabel: 'Delete',
        danger: true
      }))
    )
      return
    props.onDelete(installedIds)
  }

  return (
    <article className="model-card" id={`model-${props.entries[0]?.id}`}>
      <div className="model-head">
        <div>
          <h3>
            {title}
            {props.recommended ? <span className="badge">Recommended</span> : null}
            {props.inUse && installed ? <span className="badge badge-ok">In use</span> : null}
            {linkedFile ? (
              <span className="badge badge-ok">On this computer</span>
            ) : missingIds.length === 0 && props.entries.length > 0 && !props.custom && !props.inUse ? (
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
      {props.problem ? <p className="model-warning">{props.problem}</p> : null}
      {props.localCopy && missingIds.length > 0 ? (
        <p className="found-copy">
          <span className="badge badge-ok">Found in {copySource(props.localCopy.file)}</span> Use that file, nothing to
          download.
        </p>
      ) : null}
      {linkedFile ? (
        <p className="muted" title={linkedFile}>
          Using your file — nothing to download.
        </p>
      ) : null}

      {updates.length > 0 && active.length === 0 ? (
        <p className="muted">
          Update available ({updates.map((state) => state.update).join(', ')}), tested with this app. The current
          version is kept, in case you need to go back.
        </p>
      ) : null}

      {props.states.map((state, index) => (
        <ModelProgress key={state.id} state={state} totalBytes={props.entries[index].bytes} />
      ))}

      <div className="model-actions">
        {props.localCopy && missingIds.length > 0 && active.length === 0 ? (
          <button type="button" className="button primary" disabled={props.localCopy.busy} onClick={props.localCopy.onUse}>
            {props.localCopy.busy ? 'Checking…' : `Use the copy in ${copySource(props.localCopy.file)}`}
          </button>
        ) : null}

        {missingIds.length > 0 && active.length === 0 ? (
          <button
            type="button"
            className={props.localCopy ? 'button' : 'button primary'}
            onClick={() => props.onDownload(missingIds)}
          >
            {props.localCopy ? `Download instead (${formatBytes(totalBytes)})` : 'Download'}
          </button>
        ) : null}

        {updates.length > 0 && active.length === 0 ? (
          <button
            type="button"
            className="button primary"
            onClick={() => props.onDownload(updates.map((state) => state.id))}
          >
            Update
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
          <button type="button" className="button" onClick={() => void remove()}>
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
  const dialog = useDialog()
  const { models, hardware, recommendation, requiredEngines, download, cancel, remove } = useModels()
  // ?model=<id> (from Create's "Download it" link) scrolls to that model's card.
  const focus = useSearchParams()[0].get('model')
  useEffect(() => {
    if (focus) document.getElementById(`model-${focus}`)?.scrollIntoView({ block: 'center' })
  }, [focus])
  const { settings, update, refresh } = useSettings()
  const [engineOptions, setEngineOptions] = useState<EngineOption[] | null>(null)
  // Bumped when the user starts/stops using their own engines, so sizes are recomputed.
  const [enginesVersion, setEnginesVersion] = useState(0)
  const copies = useLocalCopies(() => setEnginesVersion((v) => v + 1))
  const llamaBuild = useOwnLlamaBuild()
  const localCopy = (id: string): CardProps['localCopy'] => {
    const file = copies.copyFor(id)
    return file ? { file, busy: copies.busy === id, onUse: () => void copies.use(id) } : undefined
  }

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
  // Builds for another engine type (e.g. CPU while the GPU is chosen). sherpa-onnx is not one of
  // those: it belongs to speaker detection and is shown there.
  const notInUse = ENGINES.filter(
    (entry) =>
      entry.engine !== 'sherpa' &&
      !selectedOption?.ids.includes(entry.id) &&
      models[entry.id]?.status === 'installed'
  )
  const notInUseBytes = notInUse.reduce((sum, entry) => sum + engineBytes(entry), 0)
  const sherpa = ENGINES.find(
    (entry) => entry.engine === 'sherpa' && entry.platform === hardware?.platform && entry.arch === hardware?.arch
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
  const reactionModels = CATALOG.filter((m) => m.kind === 'tagging')
  const installed = (entries: { id: string }[]): boolean => entries.every((entry) => models[entry.id]?.status === 'installed')
  // sherpa-onnx runs both features: keep it while the other one still needs it.
  const removeFeature =
    (other: ModelEntry[]) =>
    (ids: string[]): void =>
      removeMany(installed(other) ? ids.filter((id) => id !== sherpa?.id) : ids)

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
          <p>Everything Siftora runs on your computer: the engines, and the AI models they load.</p>
        </div>
        <button type="button" className="button" onClick={openFolder}>
          Open models folder
        </button>
      </div>

      <SystemCard />
      <SearchComputerButton />

      <section className="models-section">
        <div className="section-intro">
          <h2>Engines</h2>
          <p>The programs that run the AI models and render your reels. Choose where they run: the GPU is much faster.</p>
        </div>
        <FoundEngines onChange={() => setEnginesVersion((v) => v + 1)} />
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
                  ENGINE_ROLES[entry.engine] + (entry.backend === 'cuda' ? ' Includes the NVIDIA CUDA runtime.' : '')
              }
            ]}
            states={[stateOf(entry)]}
            title={engineLabel(entry)}
            inUse
            onDownload={download}
            onCancel={cancel}
            onDelete={removeMany}
          />
        ))}
        {notInUse.length > 0 ? (
          <details className="not-in-use">
            <summary>
              <span>
                <strong>Not in use</strong> · {notInUse.length} {notInUse.length === 1 ? 'engine' : 'engines'},{' '}
                {formatBytes(notInUseBytes)}
              </span>
              <span className="muted">Show</span>
            </summary>
            <p className="muted">
              Builds for a different engine type, downloaded earlier. Siftora only uses them if you switch the engine
              type above, so they are safe to delete. You can download them again at any time.
            </p>
            {notInUse.map((entry) => (
              <ModelCard
                key={entry.id}
                entries={[{ id: entry.id, bytes: engineBytes(entry), license: entry.license, description: ENGINE_ROLES[entry.engine] }]}
                states={[stateOf(entry)]}
                title={engineLabel(entry)}
                onDownload={download}
                onCancel={cancel}
                onDelete={removeMany}
              />
            ))}
            <div className="model-actions">
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  void dialog
                    .confirm({
                      title: `Delete ${notInUse.length} unused ${notInUse.length === 1 ? 'engine' : 'engines'}?`,
                      message: `Frees ${formatBytes(notInUseBytes)}. Siftora only uses them for another engine type, and you can download them again later.`,
                      confirmLabel: 'Delete',
                      danger: true
                    })
                    .then((ok) => ok && removeMany(notInUse.map((entry) => entry.id)))
                }}
              >
                Delete all unused ({formatBytes(notInUseBytes)})
              </button>
            </div>
          </details>
        ) : null}
      </section>

      <section className="models-section">
        <div className="section-intro">
          <h2>Transcription</h2>
          <p>Turns what is said into text with a time for every word, used to find moments and for captions. Pick one.</p>
        </div>
        <FoundTranscription onChange={() => setEnginesVersion((v) => v + 1)} />
        <p className="label list-label">
          Built into Siftora · whisper.cpp{settings.transcriptionProvider === 'openai-whisper' ? ' · not in use while OpenAI Whisper is chosen' : ''}
        </p>
        {transcriptionModels.map((entry) => (
          <ModelCard
            key={entry.id}
            entries={[entry]}
            states={[stateOf(entry)]}
            recommended={recommendation?.transcription === entry.id}
            localCopy={localCopy(entry.id)}
            warning={tooBig([entry])}
            radioName="transcription-model"
            radio={{
              checked: settings.transcriptionProvider !== 'openai-whisper' && settings.transcriptionModel === entry.id,
              onChange: () => update({ transcriptionModel: entry.id, transcriptionProvider: 'app' })
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
                checked: settings.transcriptionProvider !== 'openai-whisper' && settings.transcriptionModel === model.id,
                onChange: () => update({ transcriptionModel: model.id, transcriptionProvider: 'app' })
              }}
              onDownload={download}
              onCancel={cancel}
              onDelete={removeCustom}
              custom
            />
          ))}
      </section>

      <section className="models-section">
        <div className="section-intro">
          <h2>Clip finder AI</h2>
          <p>Reads the transcript and picks the moments with a hook, a setup and a payoff. Bigger models judge better but need more memory. Pick one.</p>
        </div>
        <FoundLlms onChange={() => setEnginesVersion((v) => v + 1)} />
        <p className="label list-label">
          Built into Siftora · llama.cpp{settings.llmProvider === 'ollama' ? ' · not in use while an Ollama model is chosen' : ''}
        </p>
        {llmModels.map((entry) => (
          <ModelCard
            key={entry.id}
            entries={[entry]}
            states={[stateOf(entry)]}
            recommended={recommendation?.llm === entry.id}
            localCopy={localCopy(entry.id)}
            warning={tooBig([entry])}
            problem={llamaTooOld(entry.gguf?.architecture, llamaBuild)}
            radioName="llm-model"
            radio={{
              checked: settings.llmProvider !== 'ollama' && settings.llmModel === entry.id,
              onChange: () => update({ llmModel: entry.id, llmProvider: 'app' })
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
                checked: settings.llmProvider !== 'ollama' && settings.llmModel === model.id,
                onChange: () => update({ llmModel: model.id, llmProvider: 'app' })
              }}
              onDownload={download}
              onCancel={cancel}
              onDelete={removeCustom}
              custom
            />
          ))}
      </section>

      <section className="models-section">
        <div className="section-intro">
          <h2>Voice detection</h2>
          <p>Finds where people actually speak, so silence and music do not turn into invented captions. Recommended.</p>
        </div>
        {vadModels.map((entry) => (
          <ModelCard
            key={entry.id}
            entries={[entry]}
            states={[stateOf(entry)]}
            title="Voice detector"
            description="Silero VAD: a tiny open-source model (under 1 MB) that whisper.cpp runs first to find the speech."
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
        <div className="section-intro">
          <h2>Speaker detection</h2>
          <p>Tells the people in a video apart, so each speaker's captions can get their own colour. Optional.</p>
        </div>
        <ModelCard
          entries={[
            ...speakerModels,
            ...(sherpa ? [{ id: sherpa.id, bytes: engineBytes(sherpa), license: sherpa.license }] : [])
          ]}
          states={[...speakerModels, ...(sherpa ? [sherpa] : [])].map(stateOf)}
          title="Speaker detection"
          description="Two small models plus sherpa-onnx, the engine that runs them. Downloaded and deleted together."
          warning={tooBig(speakerModels)}
          toggle={{
            label: 'Detect speakers in new videos',
            checked: settings.detectSpeakers,
            onChange: (detectSpeakers) => update({ detectSpeakers })
          }}
          onDownload={download}
          onCancel={cancel}
          onDelete={removeFeature(reactionModels)}
        />
      </section>

      <section className="models-section">
        <div className="section-intro">
          <h2>Reaction detection</h2>
          <p>Listens for laughter, cheering, shouting, crying and gasps, so moments that got a reaction rank higher. Optional.</p>
        </div>
        <ModelCard
          entries={[
            ...reactionModels,
            ...(sherpa ? [{ id: sherpa.id, bytes: engineBytes(sherpa), license: sherpa.license }] : [])
          ]}
          states={[...reactionModels, ...(sherpa ? [sherpa] : [])].map(stateOf)}
          title="Reaction detection"
          description="A small sound model plus sherpa-onnx, the engine that runs it (shared with speaker detection)."
          toggle={{
            label: 'Listen for reactions in new videos',
            checked: settings.detectReactions,
            onChange: (detectReactions) => update({ detectReactions })
          }}
          onDownload={download}
          onCancel={cancel}
          onDelete={removeFeature(speakerModels)}
        />
      </section>
    </div>
  )
}
