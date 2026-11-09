// Writes the engine list the app downloads (see ENGINE_LIST_URL in src/shared/engines.ts):
// the previous list with this release's Windows whisper.cpp entries and our own macOS builds
// (from <mac dir>, uploaded to the "engines" release of $GITHUB_REPOSITORY) replaced. Used by engines.yml.
//
// usage: node make-list.mjs <version> <upstream release.json> <previous.json> <out.json> <mac dir>

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [version, upstreamFile, previousFile, out, macDir] = process.argv.slice(2)
const repo = process.env.GITHUB_REPOSITORY
if (!macDir || !repo) {
  console.error('usage: GITHUB_REPOSITORY=owner/repo node make-list.mjs <version> <upstream.json> <previous.json> <out.json> <mac dir>')
  process.exit(2)
}

const upstream = JSON.parse(readFileSync(upstreamFile, 'utf8'))
const previous = JSON.parse(readFileSync(previousFile, 'utf8'))

function upstreamAsset(pattern) {
  const asset = upstream.assets.find((a) => pattern.test(a.name))
  if (!asset?.digest?.startsWith('sha256:')) throw new Error(`upstream ${version} has no asset matching ${pattern}`)
  return { url: asset.browser_download_url, bytes: asset.size, sha256: asset.digest.slice(7) }
}

function ownAsset(name) {
  const data = readFileSync(join(macDir, name))
  return {
    url: `https://github.com/${repo}/releases/download/engines/${name}`,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex')
  }
}

const whisper = (id, backend, file, license = 'MIT', platform = 'win32', arch = 'x64') => ({
  id,
  engine: 'whisper',
  backend,
  platform,
  arch,
  version,
  binary: 'whisper-cli',
  license,
  files: [file]
})

const entries = [
  whisper('whisper-win-cuda', 'cuda', upstreamAsset(/^whisper-bin-win-cuda-12[\d.]*-x64\.zip$/), 'MIT (CUDA runtime: NVIDIA EULA, redistributable)'),
  whisper('whisper-win-cpu', 'cpu', upstreamAsset(/^whisper-bin-x64\.zip$/)),
  whisper('whisper-mac-metal', 'metal', ownAsset(`whisper-${version}-macos-arm64.tar.gz`), 'MIT', 'darwin', 'arm64'),
  whisper('whisper-mac-cpu', 'cpu', ownAsset(`whisper-${version}-macos-x64.tar.gz`), 'MIT', 'darwin', 'x64')
]

const ids = new Set(entries.map((entry) => entry.id))
const list = {
  schema: 1,
  updated: new Date().toISOString(),
  engines: [...(previous.engines ?? []).filter((entry) => !ids.has(entry.id)), ...entries]
}
writeFileSync(out, `${JSON.stringify(list, null, 2)}\n`)
console.log(`engine list: ${list.engines.length} entries, whisper.cpp ${version}`)
