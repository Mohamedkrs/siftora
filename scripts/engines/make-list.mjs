// Writes the engine list the app downloads (see ENGINE_LIST_URL in src/shared/engines.ts):
// the previous list with this release's whisper.cpp entries replaced. Used by engines.yml.
//
// usage: node make-list.mjs <version> <our repo> <our release tag> <dist dir> <upstream release.json> <previous.json> <out.json>

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [version, repo, tag, dist, upstreamFile, previousFile, out] = process.argv.slice(2)
if (!out) {
  console.error('usage: node make-list.mjs <version> <repo> <tag> <dist> <upstream.json> <previous.json> <out.json>')
  process.exit(2)
}

const upstream = JSON.parse(readFileSync(upstreamFile, 'utf8'))
const previous = JSON.parse(readFileSync(previousFile, 'utf8'))

function upstreamAsset(pattern) {
  const asset = upstream.assets.find((a) => pattern.test(a.name))
  if (!asset?.digest?.startsWith('sha256:')) throw new Error(`upstream ${version} has no asset matching ${pattern}`)
  return { url: asset.browser_download_url, bytes: asset.size, sha256: asset.digest.slice(7) }
}

function ourFile(name) {
  const path = join(dist, name)
  return {
    url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex')
  }
}

const whisper = (id, platform, arch, backend, file, license = 'MIT') => ({
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

const built = readdirSync(dist)
const mac = (arch) => {
  const name = built.find((file) => file.endsWith(`-mac-${arch}.tar.gz`))
  if (!name) throw new Error(`missing macOS ${arch} build in ${dist}`)
  return ourFile(name)
}

const entries = [
  whisper('whisper-win-cuda', 'win32', 'x64', 'cuda', upstreamAsset(/^whisper-bin-win-cuda-12[\d.]*-x64\.zip$/), 'MIT (CUDA runtime: NVIDIA EULA, redistributable)'),
  whisper('whisper-win-cpu', 'win32', 'x64', 'cpu', upstreamAsset(/^whisper-bin-x64\.zip$/)),
  whisper('whisper-linux-cpu', 'linux', 'x64', 'cpu', upstreamAsset(/^whisper-bin-ubuntu-x64\.tar\.gz$/)),
  whisper('whisper-mac-metal', 'darwin', 'arm64', 'metal', mac('arm64')),
  whisper('whisper-mac-cpu', 'darwin', 'x64', 'cpu', mac('x64'))
]

const ids = new Set(entries.map((entry) => entry.id))
const list = {
  schema: 1,
  updated: new Date().toISOString(),
  engines: [...(previous.engines ?? []).filter((entry) => !ids.has(entry.id)), ...entries]
}
writeFileSync(out, `${JSON.stringify(list, null, 2)}\n`)
console.log(`engine list: ${list.engines.length} entries, whisper.cpp ${version}`)
