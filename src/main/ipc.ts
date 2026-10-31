import { app, dialog, ipcMain, shell } from 'electron'
import { IPC, type Settings } from '../shared/types'
import { cancelDownload, deleteModel, downloadModels, listModels, modelsDir } from './downloads'
import { detectHardware, engineOptions, recommend, requiredEngineInfo } from './hardware'
import { addCustomModel, removeCustomModel, scanForModels } from './localModels'
import { log } from './logger'
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

  ipcMain.handle(IPC.listModels, () => listModels())

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
