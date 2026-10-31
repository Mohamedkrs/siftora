import { app, dialog, ipcMain } from 'electron'
import { IPC, type Settings } from '../shared/types'
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
}
