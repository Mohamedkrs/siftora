import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type Api } from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  pickOutputDir: () => ipcRenderer.invoke(IPC.pickOutputDir),
  pickVideos: () => ipcRenderer.invoke(IPC.pickVideos),
  log: (level, msg) => {
    ipcRenderer.send(IPC.log, level, msg)
  },
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getPathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)
