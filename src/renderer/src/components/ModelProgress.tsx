import type { ModelState } from '../../../shared/types'
import { formatBytes, formatEta } from '../lib/format'

interface Props {
  state: ModelState
  totalBytes: number
}

export default function ModelProgress({ state, totalBytes }: Props) {
  if (state.status === 'installed' || state.status === 'missing') return null

  if (state.status === 'error') {
    return <p className="error">{state.error ?? 'Download failed.'}</p>
  }

  const percent =
    totalBytes > 0 ? Math.min(100, Math.round((state.receivedBytes / totalBytes) * 100)) : 0
  const verifying = state.status === 'verifying'
  const extracting = state.status === 'extracting'
  const queued = state.status === 'queued'

  const parts = [`${percent}%`]
  if (!verifying && !extracting && !queued && state.bytesPerSec > 0) {
    parts.push(`${formatBytes(state.bytesPerSec)}/s`)
  }
  if (!verifying && !extracting && !queued && state.etaSec) {
    parts.push(`${formatEta(state.etaSec)} left`)
  }

  return (
    <div className="model-progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={verifying || extracting ? 100 : percent}
      >
        <div className="progress-fill" style={{ width: `${verifying || extracting ? 100 : percent}%` }} />
      </div>
      <p className="progress-meta">
        {extracting
          ? 'Unpacking…'
          : verifying
            ? 'Verifying…'
            : queued
              ? 'Waiting…'
              : parts.join(' · ')}
      </p>
    </div>
  )
}
