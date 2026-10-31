import { formatBytes } from '../lib/format'
import { useModels } from '../state/models'
import NotImplemented from './NotImplemented'

const NVIDIA_URL = 'https://www.nvidia.com/Download/index.aspx'

export default function SystemCard() {
  const { hardware, recommendation } = useModels()

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

  return (
    <>
      <section className="card">
        <h2>System</h2>
        <dl className="about">
          <dt>GPU</dt>
          <dd>{gpuText}</dd>
          <dt>CUDA</dt>
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

        <div className="spaced">
          <NotImplemented phase={2} note="GPU engine pack download" />
        </div>

        {recommendation ? (
          <ul className="reasons">
            {recommendation.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        ) : null}
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
