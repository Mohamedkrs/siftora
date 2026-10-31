import type { EngineBackend, EngineOption } from '../../../shared/types'
import { ENGINES, engineLabel } from '../../../shared/engines'
import { formatBytes } from '../lib/format'

interface Props {
  options: EngineOption[]
  value: EngineBackend
  onChange: (backend: EngineOption['backend']) => void
}

export default function EngineChoice({ options, value, onChange }: Props) {
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
      {options.map((option) => (
        <label
          key={option.backend}
          className={value === option.backend ? 'choice selected' : 'choice'}
        >
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
            </strong>
            <span>
              Downloads{' '}
              {option.ids
                .map((id) => ENGINES.find((entry) => entry.id === id))
                .map((entry) => (entry ? engineLabel(entry) : null))
                .filter(Boolean)
                .join(' + ')}{' '}
              · {formatBytes(option.bytes)}
              {option.available
                ? ''
                : option.backend === 'cuda'
                  ? ' · NVIDIA CUDA is not available on this computer.'
                  : ' · Only available on Apple Silicon Macs.'}
            </span>
            {option.backend === 'cuda' ? (
              <span>Includes the NVIDIA CUDA runtime (no separate CUDA install needed).</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  )
}
