// Downloadable models. URLs, sizes and SHA-256 were verified against the hosts on
// 2026-10-31. Pinned to `resolve/main`; move to self-hosted release assets before 1.0
// (see docs/PHASE0_PROPOSAL.md, "Signed manifest").

export type ModelKind = 'transcription' | 'llm' | 'vad' | 'diarization'

export interface ModelEntry {
  id: string
  kind: ModelKind
  name: string
  description: string
  url: string
  /** File name inside the models folder. */
  file: string
  bytes: number
  sha256: string
  license: string
  /** Rough memory needed to run it (VRAM on GPU, RAM on CPU), in bytes. */
  memoryBytes: number
  /**
   * GGUF header labels (general.architecture / general.size_label). A user's own file with the
   * same labels (e.g. from Ollama) is the same model in a different packaging, so it is used
   * in place of this entry.
   */
  gguf?: { architecture: string; sizeLabel: string }
  /** Features that need this model; installing a feature means installing all its models. */
  feature?: 'speakers'
}

const GB = 1024 ** 3
const MB = 1024 ** 2
const HF_WHISPER = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'

export const CATALOG: ModelEntry[] = [
  {
    id: 'whisper-base',
    kind: 'transcription',
    name: 'Whisper Base',
    description: 'Fastest. Fine for clear speech on slow computers.',
    url: `${HF_WHISPER}/ggml-base.bin`,
    file: 'ggml-base.bin',
    bytes: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    license: 'MIT',
    memoryBytes: 0.5 * GB
  },
  {
    id: 'whisper-small',
    kind: 'transcription',
    name: 'Whisper Small',
    description: 'Good balance on CPU-only machines.',
    url: `${HF_WHISPER}/ggml-small.bin`,
    file: 'ggml-small.bin',
    bytes: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    license: 'MIT',
    memoryBytes: 1 * GB
  },
  {
    id: 'whisper-large-v3-turbo-q5',
    kind: 'transcription',
    name: 'Whisper Large v3 Turbo (compressed)',
    description: 'Near-best accuracy at a third of the size.',
    url: `${HF_WHISPER}/ggml-large-v3-turbo-q5_0.bin`,
    file: 'ggml-large-v3-turbo-q5_0.bin',
    bytes: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    license: 'MIT',
    memoryBytes: 1.5 * GB
  },
  {
    id: 'whisper-large-v3-turbo',
    kind: 'transcription',
    name: 'Whisper Large v3 Turbo',
    description: 'Best accuracy. Recommended with a GPU.',
    url: `${HF_WHISPER}/ggml-large-v3-turbo.bin`,
    file: 'ggml-large-v3-turbo.bin',
    bytes: 1624555275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
    license: 'MIT',
    memoryBytes: 2.5 * GB
  },
  {
    id: 'qwen3-4b',
    kind: 'llm',
    name: 'Qwen3 4B',
    description: 'Small and quick. For 8 GB machines.',
    url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    bytes: 2497280256,
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    license: 'Apache-2.0',
    memoryBytes: 4 * GB,
    gguf: { architecture: 'qwen3', sizeLabel: '4B' }
  },
  {
    id: 'qwen3-8b',
    kind: 'llm',
    name: 'Qwen3 8B',
    description: 'Better judgement of what is funny or surprising.',
    url: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    file: 'Qwen3-8B-Q4_K_M.gguf',
    bytes: 5027783488,
    sha256: 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785',
    license: 'Apache-2.0',
    memoryBytes: 7 * GB,
    gguf: { architecture: 'qwen3', sizeLabel: '8B' }
  },
  {
    id: 'qwen3.5-9b',
    kind: 'llm',
    name: 'Qwen3.5 9B',
    description: 'Recommended. Best clip picks for 12 GB+ GPUs.',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    file: 'Qwen3.5-9B-Q4_K_M.gguf',
    bytes: 5680522464,
    sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
    license: 'Apache-2.0',
    memoryBytes: 8 * GB,
    gguf: { architecture: 'qwen35', sizeLabel: '9B' }
  },
  {
    id: 'qwen3-14b',
    kind: 'llm',
    name: 'Qwen3 14B',
    description: 'Largest. Needs a 16 GB GPU; slow on CPU.',
    url: 'https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',
    file: 'Qwen3-14B-Q4_K_M.gguf',
    bytes: 9001752960,
    sha256: '500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0',
    license: 'Apache-2.0',
    memoryBytes: 11 * GB,
    gguf: { architecture: 'qwen3', sizeLabel: '14B' }
  },
  {
    id: 'silero-vad',
    kind: 'vad',
    name: 'Silero voice detection',
    description: 'Skips silence and music so Whisper does not invent words.',
    url: `${SHERPA}/asr-models/silero_vad.onnx`,
    file: 'silero_vad.onnx',
    bytes: 643854,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    license: 'MIT',
    memoryBytes: 50 * MB
  },
  {
    id: 'pyannote-segmentation-3',
    kind: 'diarization',
    name: 'Speaker turns (pyannote 3.0)',
    description: 'Finds where each speaker starts and stops.',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx',
    file: 'pyannote-segmentation-3-0.onnx',
    bytes: 5992913,
    sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
    license: 'MIT',
    memoryBytes: 200 * MB,
    feature: 'speakers'
  },
  {
    id: 'wespeaker-resnet34',
    kind: 'diarization',
    name: 'Voice fingerprints (WeSpeaker)',
    description: 'Tells speakers apart so each gets its own caption color.',
    // "recongition" is the real (misspelled) release tag upstream.
    url: `${SHERPA}/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx`,
    file: 'wespeaker_en_voxceleb_resnet34_LM.onnx',
    bytes: 26530550,
    sha256: 'e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012',
    license: 'Apache-2.0',
    memoryBytes: 300 * MB,
    feature: 'speakers'
  }
]

export const SPEAKER_MODEL_IDS = CATALOG.filter((m) => m.feature === 'speakers').map((m) => m.id)
