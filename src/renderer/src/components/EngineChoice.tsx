import type { EngineBackend, EngineOption } from '../../../shared/types'
import { ENGINES, engineBytes, engineLabel } from '../../../shared/engines'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'

interface Props {
  options: EngineOption[]
  value: EngineBackend
  onChange: (backend: EngineOption['backend']) => void
}

export default function EngineChoice({ options, value, onChange }: Props) {
  const { models } = useModels()

  // Engines covered by the user's own programs (Ollama, Python Whisper, FFmpeg) are not in `ids`.
  if (options.length > 0 && options.every((option) => option.ids.length === 0)) {
    return (
      <p className="muted">
        Nothing to download — clip finding, transcription and video are all handled by programs
        already on this computer.
      </p>
    )
  }

  return (
    <div className="choice-list">
      <p className="muted">
        Only needed for the parts not handled by programs already on this computer (see above).
      </p>
      {options.map((option) => {
        const entries = option.ids.flatMap((id) => ENGINES.filter((entry) => entry.id === id))
        const have = entries.filter((entry) => models[entry.id]?.status === 'installed')
        const need = entries.filter((entry) => models[entry.id]?.status !== 'installed')
        const needBytes = need.reduce((sum, entry) => sum + engineBytes(entry), 0)
        const names = (list: typeof entries): string => list.map(engineLabel).join(' + ')
        return (
          <label key={option.backend} className={value === option.backend ? 'choice selected' : 'choice'}>
            <input
              type="radio"
              name="engine-backend"
              checked={value === option.backend}
              disabled={!option.available}
              onChange={() => onChange(option.backend)}
            />
            <span className="choice-text">
              <strong>
                {option.label}
                {option.recommended ? <span className="badge">Recommended</span> : null}
                {entries.length > 0 && need.length === 0 ? (
                  <span className="badge badge-ok">Already downloaded</span>
                ) : null}
              </strong>
              <span>
                {need.length === 0
                  ? `Uses ${names(have)} · nothing to download`
                  : [
                      `Downloads ${names(need)} · ${formatBytes(needBytes)}`,
                      have.length > 0 ? `${names(have)} already downloaded` : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                {option.available
                  ? ''
                  : option.backend === 'cuda'
                    ? ' · NVIDIA CUDA is not available on this computer.'
                    : ' · Only available on Apple Silicon Macs.'}
              </span>
              {option.backend === 'cuda' && need.length > 0 ? (
                <span>Includes the NVIDIA CUDA runtime (no separate CUDA install needed).</span>
              ) : null}
            </span>
          </label>
        )
      })}
    </div>
  )
}
