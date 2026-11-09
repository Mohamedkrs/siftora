import { app } from 'electron'
import { log } from './logger'

/** Newer release on GitHub, or null (up to date, offline, or GitHub did not answer). */
export interface AppUpdate {
  version: string
  url: string
}

/** True when version a is newer than b ("0.10.0" > "0.9.1"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  }
  return false
}

let checked: Promise<AppUpdate | null> | null = null

/** Asks GitHub once per launch; later calls get the same answer. */
export function checkForUpdate(): Promise<AppUpdate | null> {
  checked ??= (async () => {
    const response = await fetch('https://api.github.com/repos/Mohamedkrs/siftora/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : ''
    if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewer(version, app.getVersion())) return null
    const url = typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/')
      ? release.html_url
      : 'https://github.com/Mohamedkrs/siftora/releases/latest'
    log.info('updates', `Siftora ${version} is available`)
    return { version, url }
  })().catch((err: unknown) => {
    log.warn('updates', `update check failed: ${String(err)}`)
    checked = null // try again next time something asks
    return null
  })
  return checked
}
