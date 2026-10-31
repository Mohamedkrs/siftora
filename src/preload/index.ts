import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type Api, type ModelState } from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  pickOutputDir: () => ipcRenderer.invoke(IPC.pickOutputDir),
  pickVideos: () => ipcRenderer.invoke(IPC.pickVideos),
  log: (level, msg) => {
    ipcRenderer.send(IPC.log, level, msg)
  },
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getHardware: () => ipcRenderer.invoke(IPC.getHardware),
  getRecommendation: () => ipcRenderer.invoke(IPC.getRecommendation),
  getRequiredEngines: () => ipcRenderer.invoke(IPC.getRequiredEngines),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  downloadModels: (ids) => ipcRenderer.invoke(IPC.downloadModels, ids),
  cancelDownload: (id) => ipcRenderer.invoke(IPC.cancelDownload, id),
  deleteModel: (id) => ipcRenderer.invoke(IPC.deleteModel, id),
  openModelsFolder: () => ipcRenderer.invoke(IPC.openModelsFolder),
  onModelState: (cb) => {
    const listener = (_event: IpcRendererEvent, state: ModelState): void => cb(state)
    ipcRenderer.on(IPC.onModelState, listener)
    return () => ipcRenderer.removeListener(IPC.onModelState, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
