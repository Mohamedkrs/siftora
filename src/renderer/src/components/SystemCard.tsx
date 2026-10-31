import { ENGINES, engineBytes } from '../../../shared/engines'
import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'

const NVIDIA_URL = 'https://www.nvidia.com/Download/index.aspx'

export default function SystemCard() {
  const { models, hardware, recommendation, requiredEngines, checking, recheck } = useModels()

  if (!hardware) {
    return (
      <section className="card">
        <div className="loading-row" role="status">
          <span className="spinner" aria-hidden="true" />
          Checking your hardware…
        </div>
      </section>
    )
  }

  const gpuText =
    hardware.gpus
      .map((gpu) => `${gpu.name}${gpu.vramBytes ? ` (${formatBytes(gpu.vramBytes)} VRAM)` : ''}`)
      .join(', ') || 'None detected'

  const cudaParts: string[] = []
  if (hardware.cuda.driverVersion) cudaParts.push(`driver ${hardware.cuda.driverVersion}`)
  if (hardware.cuda.cudaVersion) cudaParts.push(`CUDA ${hardware.cuda.cudaVersion}`)
  const cudaText = hardware.cuda.usable
    ? `available${cudaParts.length > 0 ? ` (${cudaParts.join(', ')})` : ''}`
    : 'not available'

  const nvidiaGpu = hardware.gpus.find((gpu) => gpu.vendor === 'nvidia')

  const engineEntries = requiredEngines
    ? ENGINES.filter((entry) => requiredEngines.ids.includes(entry.id))
    : []
  const engineBytesTotal = engineEntries.reduce((sum, entry) => sum + engineBytes(entry), 0)
  const enginesInstalled =
    engineEntries.length > 0 &&
    engineEntries.every((entry) => models[entry.id]?.status === 'installed')

  return (
    <>
      <section className="card">
        <h2>System</h2>
        <dl className="about">
          <dt>GPU</dt>
          <dd>{gpuText}</dd>
          <dt>CUDA on this PC</dt>
          <dd>{cudaText}</dd>
          <dt>RAM</dt>
          <dd>{formatBytes(hardware.ramBytes)}</dd>
          <dt>CPU</dt>
          <dd>
            {hardware.cpuModel} ({hardware.cores} cores)
          </dd>
          <dt>Backend</dt>
          <dd>{hardware.backend.toUpperCase()}</dd>
        </dl>

        {requiredEngines && hardware.backend !== 'cpu' ? (
          <p className="muted">
            GPU-accelerated engines (app download):{' '}
            {enginesInstalled
              ? 'installed'
              : `not downloaded yet (${formatBytes(engineBytesTotal)}) — choose them in Models → Engines`}
          </p>
        ) : null}

        {recommendation ? (
          <ul className="reasons">
            {recommendation.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <div className="actions spaced">
          <button type="button" className="button" disabled={checking} onClick={recheck}>
            {checking ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Checking…
              </>
            ) : (
              'Recheck my system'
            )}
          </button>
        </div>
      </section>

      {nvidiaGpu && !hardware.cuda.usable ? (
        <section className="card warning-card">
          <h2>NVIDIA GPU detected</h2>
          <p>
            Your NVIDIA GPU could make processing 5–10× faster. Install/update the NVIDIA driver to
            enable CUDA.
          </p>
          <button type="button" className="button" onClick={() => window.open(NVIDIA_URL)}>
            Get the NVIDIA driver
          </button>
        </section>
      ) : null}
    </>
  )
}
