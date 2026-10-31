import { app, dialog, ipcMain, shell } from 'electron'
import { IPC, type Settings } from '../shared/types'
import { currentEngineList } from './engineList'
import { deleteDownloads, quitAfterRemoval, removeAllData, storageUsage } from './storage'
import { cancelDownload, deleteModel, downloadModels, listModels, modelsDir } from './downloads'
import { detectHardware, engineOptions, recommend, requiredEngineInfo } from './hardware'
import { addCustomModel, removeCustomModel, scanForModels } from './localModels'
import { addJobs, cancelJob, deleteJob, deleteReel, findAgain, listJobs, removeJob, renderClips, retryJob } from './jobs'
import { log } from './logger'
import {
  detectOllama,
  detectOpenAiWhisper,
  findSystemEngines,
  inspectEngineBinary
} from './systemEngines'
import { getSettings, setSettings } from './settings'

export function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => getSettings())

  ipcMain.handle(IPC.setSettings, (_event, patch: Partial<Settings>) => setSettings(patch))

  ipcMain.handle(IPC.pickOutputDir, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.pickVideos, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.on(IPC.log, (_event, level: unknown, msg: unknown) => {
    if (level !== 'info' && level !== 'warn' && level !== 'error') return
    log[level]('renderer', String(msg))
  })

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData')
  }))

  ipcMain.handle(IPC.getHardware, (_event, force: unknown) => detectHardware(force === true))

  ipcMain.handle(IPC.getRecommendation, async () => recommend(await detectHardware()))

  ipcMain.handle(IPC.getRequiredEngines, () => requiredEngineInfo())

  ipcMain.handle(IPC.getEngineOptions, () => engineOptions())

  ipcMain.handle(IPC.findSystemEngines, (_event, force: unknown) => findSystemEngines(force === true))

  ipcMain.handle(IPC.pickEngineBinary, async (_event, engine: unknown) => {
    const result = await dialog.showOpenDialog({
      title: `Choose ${String(engine)}`,
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }] : []
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.useSystemEngine, async (_event, engine: unknown, path: unknown) => {
    if ((engine !== 'llama' && engine !== 'whisper' && engine !== 'ffmpeg') || typeof path !== 'string') {
      return { ok: false, problem: 'Invalid request' }
    }
    const checked = await inspectEngineBinary(engine, path)
    if (!checked.usable) return { ok: false, problem: checked.problem ?? 'Not usable' }
    setSettings({ enginePaths: { ...getSettings().enginePaths, [engine]: path } })
    log.info('engines', `using system ${engine}: ${path}`)
    return { ok: true }
  })

  ipcMain.handle(IPC.stopUsingSystemEngine, (_event, engine: unknown) => {
    const enginePaths = { ...getSettings().enginePaths }
    if (engine === 'llama' || engine === 'whisper' || engine === 'ffmpeg') delete enginePaths[engine]
    setSettings({ enginePaths })
  })

  ipcMain.handle(IPC.detectOllama, () => detectOllama())

  ipcMain.handle(IPC.detectOpenAiWhisper, () => detectOpenAiWhisper())

  ipcMain.handle(IPC.listModels, () => listModels())

  ipcMain.handle(IPC.getEngineList, () => currentEngineList())
  ipcMain.handle(IPC.downloadModels, (_event, ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    downloadModels(list)
  })

  ipcMain.handle(IPC.cancelDownload, (_event, id: unknown) => {
    cancelDownload(String(id))
  })

  ipcMain.handle(IPC.deleteModel, async (_event, id: unknown) => {
    await deleteModel(String(id))
  })

  const ids = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

  ipcMain.handle(IPC.addJobs, (_event, sources: unknown) => addJobs(ids(sources)))
  ipcMain.handle(IPC.listJobs, () => listJobs())
  ipcMain.handle(IPC.cancelJob, (_event, id: unknown) => cancelJob(String(id)))
  ipcMain.handle(IPC.removeJob, (_event, id: unknown) => removeJob(String(id)))
  ipcMain.handle(IPC.retryJob, (_event, id: unknown) => retryJob(String(id)))
  ipcMain.handle(IPC.findAgain, (_event, id: unknown) => findAgain(String(id)))
  ipcMain.handle(IPC.renderClips, (_event, jobId: unknown, clipIds: unknown) => renderClips(String(jobId), ids(clipIds)))
  // Only files the app produced or the user chose are passed here; still, never run programs.
  ipcMain.handle(IPC.deleteJob, (_event, id: unknown) => deleteJob(String(id)))
  ipcMain.handle(IPC.deleteReel, (_event, jobId: unknown, clipId: unknown) => deleteReel(String(jobId), String(clipId)))
  ipcMain.handle(IPC.openPath, async (_event, path: unknown) => {
    if (typeof path === 'string' && !/\.(exe|bat|cmd|com|ps1|sh|app|msi|lnk)$/i.test(path)) await shell.openPath(path)
  })
  ipcMain.handle(IPC.showInFolder, (_event, path: unknown) => {
    if (typeof path === 'string') shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.getStorage, () => storageUsage())
  ipcMain.handle(IPC.openDataFolder, async () => {
    await shell.openPath(app.getPath('userData'))
  })
  ipcMain.handle(IPC.deleteDownloads, () => deleteDownloads())
  ipcMain.handle(IPC.removeAllData, () => removeAllData())
  ipcMain.handle(IPC.quitAfterRemoval, () => quitAfterRemoval())
  ipcMain.handle(IPC.openModelsFolder, async () => {
    await shell.openPath(modelsDir())
  })

  ipcMain.handle(IPC.scanForModels, () => scanForModels())

  ipcMain.handle(IPC.pickModelFile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Model files', extensions: ['gguf', 'bin'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.addCustomModel, async (_event, path: unknown, name: unknown) => {
    if (typeof path !== 'string') return { error: 'No model file selected.' }
    const label = typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined
    try {
      return { id: await addCustomModel(path, label) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.removeCustomModel, async (_event, id: unknown) => {
    await removeCustomModel(String(id))
  })
}
