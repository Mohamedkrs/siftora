// Engine builds (llama.cpp, whisper.cpp, FFmpeg) per OS/arch/backend. Sizes and SHA-256
// come from the GitHub release asset digests, checked 2026-10-31.
// These are the fallback; the tested list published by .github/workflows/engines.yml (see
// ENGINE_LIST_URL) overrides them and adds builds upstream does not ship (macOS whisper.cpp).
// TODO before 1.0: mirror FFmpeg too (BtbN prunes old autobuild tags; no macOS build yet).

export type EngineName = 'llama' | 'whisper' | 'ffmpeg' | 'sherpa'
export type Backend = 'cuda' | 'metal' | 'vulkan' | 'cpu'
export type Platform = 'win32' | 'linux' | 'darwin'

export interface EngineFile {
  url: string
  bytes: number
  sha256: string
}

export interface EngineEntry {
  id: string
  engine: EngineName
  backend: Backend
  platform: Platform
  arch: 'x64' | 'arm64'
  /** Archives are all extracted into the same engines/<id>/ folder. */
  files: EngineFile[]
  /** Executable to look for (recursively) after extraction, without .exe. */
  binary: string
  license: string
  /** Upstream release, e.g. "b5454". Installed engines whose version differs from the list are offered an update. */
  version?: string
  /**
   * Resolve the newest build at install time from this repo's rolling "latest" release; the
   * asset regex's first two groups are the major/minor version. `files` is the fallback.
   */
  latest?: { repo: string; asset: RegExp }
}

const LLAMA = 'https://github.com/ggml-org/llama.cpp/releases/download/b12020'
const WHISPER = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454'
const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1'
const FFMPEG = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59'

export const ENGINES: EngineEntry[] = [
  // ── sherpa-onnx: speaker detection (only installed with the speaker detection feature) ──
  {
    id: 'sherpa-win',
    engine: 'sherpa',
    backend: 'cpu',
    platform: 'win32',
    arch: 'x64',
    files: [{ url: `${SHERPA}/sherpa-onnx-v2.0.1-win-x64-shared-MD-Release-no-tts.tar.bz2`, bytes: 20962760, sha256: '11fd6a50b97eed38b54fb16d8219f49b16aa7f6a8e43a042316469ef47652e82' }],
    binary: 'sherpa-onnx-offline-speaker-diarization',
    license: 'Apache-2.0',
    version: 'v2.0.1'
  },
  {
    id: 'sherpa-linux',
    engine: 'sherpa',
    backend: 'cpu',
    platform: 'linux',
    arch: 'x64',
    files: [{ url: `${SHERPA}/sherpa-onnx-v2.0.1-linux-x64-shared-no-tts.tar.bz2`, bytes: 25289904, sha256: 'b3b095f619059d54914027ff38f8a0a132ea3bbc5df32a212a9743a8bd1467b2' }],
    binary: 'sherpa-onnx-offline-speaker-diarization',
    license: 'Apache-2.0',
    version: 'v2.0.1'
  },
  ...(['arm64', 'x64'] as const).map((arch) => ({
    id: `sherpa-mac-${arch}`,
    engine: 'sherpa' as const,
    backend: 'cpu' as const,
    platform: 'darwin' as const,
    arch,
    files: [{ url: `${SHERPA}/sherpa-onnx-v2.0.1-osx-universal2-shared-no-tts.tar.bz2`, bytes: 40097083, sha256: '9021b6f33e8d1657fe5ae7a13e83fc948707f86b749dc7b775680db6451cc2b8' }],
    binary: 'sherpa-onnx-offline-speaker-diarization',
    license: 'Apache-2.0',
    version: 'v2.0.1'
  })),

  // ── Windows x64 ──
  {
    id: 'llama-win-cuda',
    engine: 'llama',
    backend: 'cuda',
    platform: 'win32',
    arch: 'x64',
    files: [
      { url: `${LLAMA}/llama-b12020-bin-win-cuda-12.4-x64.zip`, bytes: 279944190, sha256: '5e19eb50eb774f373f6e3a7c4c30e50b6fe758509592f3d2598a5b7dd296ab5c' },
      { url: `${LLAMA}/cudart-llama-bin-win-cuda-12.4-x64.zip`, bytes: 391443627, sha256: '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6' }
    ],
    binary: 'llama-server',
    license: 'MIT (CUDA runtime: NVIDIA EULA, redistributable)',
    version: 'b12020'
  },
  {
    id: 'llama-win-vulkan',
    engine: 'llama',
    backend: 'vulkan',
    platform: 'win32',
    arch: 'x64',
    files: [{ url: `${LLAMA}/llama-b12020-bin-win-vulkan-x64.zip`, bytes: 37515077, sha256: 'aa3452dfa16cdf7d902b44e5445e43e13023c64fb179ca7a13d60611d4371691' }],
    binary: 'llama-server',
    license: 'MIT',
    version: 'b12020'
  },
  {
    id: 'llama-win-cpu',
    engine: 'llama',
    backend: 'cpu',
    platform: 'win32',
    arch: 'x64',
    files: [{ url: `${LLAMA}/llama-b12020-bin-win-cpu-x64.zip`, bytes: 24574627, sha256: '07e81782f5a16c7ffef42403183808e02f271c9ece3aa2d64040b2620ae8d519' }],
    binary: 'llama-server',
    license: 'MIT',
    version: 'b12020'
  },
  {
    id: 'whisper-win-cuda',
    engine: 'whisper',
    backend: 'cuda',
    platform: 'win32',
    arch: 'x64',
    files: [{ url: `${WHISPER}/whisper-bin-win-cuda-12.4.0-x64.zip`, bytes: 684913404, sha256: 'afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a' }],
    binary: 'whisper-cli',
    license: 'MIT (CUDA runtime: NVIDIA EULA, redistributable)',
    version: 'b5454'
  },
  {
    id: 'whisper-win-cpu',
    engine: 'whisper',
    backend: 'cpu',
    platform: 'win32',
    arch: 'x64',
    files: [{ url: `${WHISPER}/whisper-bin-x64.zip`, bytes: 8928640, sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb' }],
    binary: 'whisper-cli',
    license: 'MIT',
    version: 'b5454'
  },
  {
    id: 'ffmpeg-win',
    engine: 'ffmpeg',
    backend: 'cpu',
    platform: 'win32',
    arch: 'x64',
    files: [{ url: `${FFMPEG}/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip`, bytes: 194182300, sha256: '401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f' }],
    binary: 'ffmpeg',
    license: 'GPL-3.0',
    // Newest stable branch (n9.0, n9.1, …), not the nightly "master" builds.
    latest: { repo: 'BtbN/FFmpeg-Builds', asset: /^ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-[\d.]+\.zip$/ }
  },

  // ── Linux x64 ──
  {
    id: 'llama-linux-vulkan',
    engine: 'llama',
    backend: 'vulkan',
    platform: 'linux',
    arch: 'x64',
    files: [{ url: `${LLAMA}/llama-b12020-bin-ubuntu-vulkan-x64.tar.gz`, bytes: 35664875, sha256: '8b7ec1fbef304ea4e024cf34f68ef1276556b38b666dc71b8af5de6e9d93b42c' }],
    binary: 'llama-server',
    license: 'MIT',
    version: 'b12020'
  },
  {
    id: 'llama-linux-cuda',
    engine: 'llama',
    backend: 'cuda',
    platform: 'linux',
    arch: 'x64',
    files: [
      { url: `${LLAMA}/llama-b12020-bin-ubuntu-cuda-12.8-x64.tar.gz`, bytes: 182781376, sha256: '0170c61c0ddf6208215a68b36f78f45b1641631317736c093f3faa40f05f8e85' },
      { url: `${LLAMA}/cudart-llama-b12020-bin-ubuntu-cuda-12.8-x64.tar.gz`, bytes: 594372521, sha256: 'a17d59ed20873a82cbf2ff6c651d5bb432689d8569b4af0b6b1c7e35aeb001ba' }
    ],
    binary: 'llama-server',
    license: 'MIT (CUDA runtime: NVIDIA EULA, redistributable)',
    version: 'b12020'
  },
  {
    id: 'llama-linux-cpu',
    engine: 'llama',
    backend: 'cpu',
    platform: 'linux',
    arch: 'x64',
    files: [{ url: `${LLAMA}/llama-b12020-bin-ubuntu-x64.tar.gz`, bytes: 22880149, sha256: '1b69032f9ab60dc6aa909689fda941fa1b9162f6ab46b863582d5649d96ac6be' }],
    binary: 'llama-server',
    license: 'MIT',
    version: 'b12020'
  },
  {
    id: 'whisper-linux-cpu',
    engine: 'whisper',
    backend: 'cpu',
    platform: 'linux',
    arch: 'x64',
    files: [{ url: `${WHISPER}/whisper-bin-ubuntu-x64.tar.gz`, bytes: 10364195, sha256: 'a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c' }],
    binary: 'whisper-cli',
    license: 'MIT',
    version: 'b5454'
  },
  {
    id: 'ffmpeg-linux',
    engine: 'ffmpeg',
    backend: 'cpu',
    platform: 'linux',
    arch: 'x64',
    files: [{ url: `${FFMPEG}/ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1.tar.xz`, bytes: 152246308, sha256: '41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380' }],
    binary: 'ffmpeg',
    license: 'GPL-3.0',
    latest: { repo: 'BtbN/FFmpeg-Builds', asset: /^ffmpeg-n(\d+)\.(\d+)-latest-linux64-gpl-[\d.]+\.tar\.xz$/ }
  },

  // ── macOS ── (whisper.cpp and FFmpeg: own builds needed, see TODO above)
  {
    id: 'llama-mac-metal',
    engine: 'llama',
    backend: 'metal',
    platform: 'darwin',
    arch: 'arm64',
    files: [{ url: `${LLAMA}/llama-b12020-bin-macos-arm64.tar.gz`, bytes: 16509249, sha256: 'b630ebd5da34b02e86f7294dd5743aba842a0a02cb023130debd64599721c541' }],
    binary: 'llama-server',
    license: 'MIT',
    version: 'b12020'
  },
  {
    id: 'llama-mac-cpu',
    engine: 'llama',
    backend: 'cpu',
    platform: 'darwin',
    arch: 'x64',
    files: [{ url: `${LLAMA}/llama-b12020-bin-macos-x64.tar.gz`, bytes: 12248997, sha256: '774fba46a668cf6c94eb8d515b2dfb5897878ab6da08943585f487a1dd1aa6a0' }],
    binary: 'llama-server',
    license: 'MIT',
    version: 'b12020'
  }
]

/**
 * Tested engine builds published by .github/workflows/engines.yml. Set ENGINE_REPO to the
 * project's "owner/repo" once it is on GitHub; until then the app only uses the list above.
 */
export const ENGINE_REPO: string | null = null
export const ENGINE_LIST_URL = ENGINE_REPO
  ? `https://github.com/${ENGINE_REPO}/releases/download/engines/engines.json`
  : null

const BUILT_IN = [...ENGINES]

/** Built-in version of an engine, for installs made before versions were recorded. */
export function builtInVersion(id: string): string | undefined {
  return BUILT_IN.find((entry) => entry.id === id)?.version
}

/**
 * Applies the published list: its entries replace built-ins with the same id and add new ones
 * (e.g. macOS whisper.cpp). ENGINES is updated in place so every importer sees the change.
 */
export function applyEngineList(published: EngineEntry[]): void {
  const byId = new Map(published.map((entry) => [entry.id, entry]))
  const merged = BUILT_IN.map((entry) => {
    const next = byId.get(entry.id)
    // Keep `latest` (a RegExp, not in JSON) for engines that resolve their newest build.
    return next ? { ...next, latest: entry.latest } : entry
  })
  for (const entry of published) if (!BUILT_IN.some((b) => b.id === entry.id)) merged.push(entry)
  ENGINES.splice(0, ENGINES.length, ...merged)
}

const PREFERENCE: Backend[] = ['cuda', 'metal', 'vulkan', 'cpu']

/** Best build of `engine` for this machine, given the backend the hardware check chose. */
export function pickEngine(
  engine: EngineName,
  platform: string,
  arch: string,
  backend: Backend
): EngineEntry | null {
  const candidates = ENGINES.filter(
    (e) => e.engine === engine && e.platform === platform && e.arch === arch
  )
  const order = PREFERENCE.slice(PREFERENCE.indexOf(backend))
  for (const b of order) {
    const hit = candidates.find((e) => e.backend === b)
    if (hit) return hit
  }
  return null
}

export function engineBytes(entry: EngineEntry): number {
  return entry.files.reduce((sum, f) => sum + f.bytes, 0)
}

const LABELS: Record<EngineName, string> = {
  llama: 'llama.cpp',
  whisper: 'whisper.cpp',
  ffmpeg: 'FFmpeg',
  sherpa: 'sherpa-onnx (speakers)'
}

/** Display name, e.g. "llama.cpp (CUDA)" or "FFmpeg" for CPU builds. */
export function engineLabel(entry: EngineEntry): string {
  return entry.backend === 'cpu'
    ? LABELS[entry.engine]
    : `${LABELS[entry.engine]} (${entry.backend.toUpperCase()})`
}
