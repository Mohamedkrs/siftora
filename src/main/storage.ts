import { app } from 'electron'
import { spawn } from 'node:child_process'
import { readdir, rm, lstat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { StorageUsage } from '../shared/types'
import { isDownloading, resetModelStates } from './downloads'
import { isBusy } from './jobs'
import { log } from './logger'

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const BUSY = 'Wait until videos in the queue, rendering and downloads have finished, then try again.'

async function folderSize(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) total += await folderSize(full)
    else if (entry.isFile()) {
      try {
        total += (await lstat(full)).size
      } catch {
        // Vanished while counting.
      }
    }
  }
  return total
}

const root = (): string => app.getPath('userData')

/** How much space the data folder takes, by what it holds. Linked models (e.g. Ollama's) live elsewhere. */
export async function storageUsage(): Promise<StorageUsage> {
  const [total, engines, models, results] = await Promise.all([
    folderSize(root()),
    folderSize(join(root(), 'engines')),
    folderSize(join(root(), 'models')),
    folderSize(join(root(), 'jobs'))
  ])
  return { folder: root(), total, engines, models, results, other: Math.max(0, total - engines - models - results) }
}

/** Deletes the downloaded engines and models; settings and results stay. */
export async function deleteDownloads(): Promise<{ ok: boolean; problem?: string; freed?: number }> {
  if (isBusy() || isDownloading()) return { ok: false, problem: BUSY }
  const before = await storageUsage()
  try {
    await rm(join(root(), 'engines'), { recursive: true, force: true })
    await rm(join(root(), 'models'), { recursive: true, force: true })
  } catch (err) {
    log.error('storage', `could not delete downloads: ${String(err)}`)
    return { ok: false, problem: 'Some files could not be deleted. Close anything using them and try again.' }
  } finally {
    resetModelStates()
  }
  log.info('storage', `deleted downloads (${before.engines + before.models} bytes)`)
  return { ok: true, freed: before.engines + before.models }
}

/** Only ever the app's own data folder: named Siftora, inside the OS app-data folder. */
function isOwnDataFolder(folder: string): boolean {
  return basename(folder) === 'Siftora' && resolve(dirname(folder)) === resolve(app.getPath('appData'))
}

let removed = false

/**
 * Removes everything in the data folder, for before deleting the app (macOS and Linux have no
 * uninstaller). What can go now goes now; quitAfterRemoval() then quits and removes the rest
 * (files Electron keeps open). Rendered reels in Videos are not touched.
 */
export async function removeAllData(): Promise<{ ok: boolean; problem?: string; removed?: StorageUsage }> {
  if (isBusy() || isDownloading()) return { ok: false, problem: BUSY }
  const folder = root()
  if (!isOwnDataFolder(folder)) {
    log.error('storage', `refusing to remove unexpected data folder ${folder}`)
    return { ok: false, problem: `The data folder is not where Siftora expects it (${folder}), so nothing was removed.` }
  }
  const usage = await storageUsage()
  for (const part of ['engines', 'models', 'jobs', 'settings.json']) {
    await rm(join(folder, part), { recursive: true, force: true }).catch(() => undefined)
  }
  removed = true
  log.info('storage', `removed all data (${usage.total} bytes)`)
  return { ok: true, removed: usage }
}

/** After removeAllData: quit, then a small helper deletes what is left once the app has exited. */
export function quitAfterRemoval(): void {
  if (!removed) return
  const folder = root()
  if (!isOwnDataFolder(folder)) return
  const helper =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"ping -n 3 127.0.0.1 >nul & rmdir /s /q "${folder}""`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          windowsVerbatimArguments: true
        })
      : spawn('/bin/sh', ['-c', 'sleep 2; rm -rf -- "$0"', folder], { detached: true, stdio: 'ignore' })
  helper.unref()
  app.quit()
}
