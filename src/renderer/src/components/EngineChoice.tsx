import type { EngineBackend, EngineOption } from '../../../shared/types'
import { formatBytes } from '../lib/format'

interface Props {
  options: EngineOption[]
  value: EngineBackend
  onChange: (backend: EngineOption['backend']) => void
}

export default function EngineChoice({ options, value, onChange }: Props) {
  return (
    <div className="choice-list">
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
              {formatBytes(option.bytes)}
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
