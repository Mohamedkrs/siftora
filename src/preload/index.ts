import type { EngineEntry } from '../shared/engines'
import type { Job } from '../shared/jobs'
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type Api, type ModelState } from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  pickOutputDir: () => ipcRenderer.invoke(IPC.pickOutputDir),
  importCookiesFile: () => ipcRenderer.invoke(IPC.importCookiesFile),
  pickVideos: () => ipcRenderer.invoke(IPC.pickVideos),
  youtubeInfo: (url) => ipcRenderer.invoke(IPC.youtubeInfo, url),
  ytDlpInstalled: () => ipcRenderer.invoke(IPC.ytDlpInstalled),
  log: (level, msg) => {
    ipcRenderer.send(IPC.log, level, msg)
  },
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getHardware: (force) => ipcRenderer.invoke(IPC.getHardware, force),
  getRecommendation: () => ipcRenderer.invoke(IPC.getRecommendation),
  getRequiredEngines: () => ipcRenderer.invoke(IPC.getRequiredEngines),
  getEngineOptions: () => ipcRenderer.invoke(IPC.getEngineOptions),
  ownLlamaBuild: () => ipcRenderer.invoke(IPC.ownLlamaBuild),
  findSystemEngines: (force) => ipcRenderer.invoke(IPC.findSystemEngines, force),
  pickEngineBinary: (engine) => ipcRenderer.invoke(IPC.pickEngineBinary, engine),
  useSystemEngine: (engine, path) => ipcRenderer.invoke(IPC.useSystemEngine, engine, path),
  stopUsingSystemEngine: (engine) => ipcRenderer.invoke(IPC.stopUsingSystemEngine, engine),
  detectOllama: () => ipcRenderer.invoke(IPC.detectOllama),
  detectOpenAiWhisper: () => ipcRenderer.invoke(IPC.detectOpenAiWhisper),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  downloadModels: (ids) => ipcRenderer.invoke(IPC.downloadModels, ids),
  cancelDownload: (id) => ipcRenderer.invoke(IPC.cancelDownload, id),
  deleteModel: (id) => ipcRenderer.invoke(IPC.deleteModel, id),
  openModelsFolder: () => ipcRenderer.invoke(IPC.openModelsFolder),
  getStorage: () => ipcRenderer.invoke(IPC.getStorage),
  openDataFolder: () => ipcRenderer.invoke(IPC.openDataFolder),
  deleteDownloads: () => ipcRenderer.invoke(IPC.deleteDownloads),
  removeAllData: () => ipcRenderer.invoke(IPC.removeAllData),
  quitAfterRemoval: () => ipcRenderer.invoke(IPC.quitAfterRemoval),
  scanForModels: () => ipcRenderer.invoke(IPC.scanForModels),
  pickModelFile: () => ipcRenderer.invoke(IPC.pickModelFile),
  addCustomModel: (path, name) => ipcRenderer.invoke(IPC.addCustomModel, path, name),
  removeCustomModel: (id) => ipcRenderer.invoke(IPC.removeCustomModel, id),
  getEngineList: () => ipcRenderer.invoke(IPC.getEngineList),
  onEngineList: (cb) => {
    const listener = (_event: IpcRendererEvent, entries: EngineEntry[]) => cb(entries)
    ipcRenderer.on(IPC.onEngineList, listener)
    return () => ipcRenderer.removeListener(IPC.onEngineList, listener)
  },
  onModelState: (cb) => {
    const listener = (_event: IpcRendererEvent, state: ModelState): void => cb(state)
    ipcRenderer.on(IPC.onModelState, listener)
    return () => ipcRenderer.removeListener(IPC.onModelState, listener)
  },
  addJobs: (sources, links, limits) => ipcRenderer.invoke(IPC.addJobs, sources, links, limits),
  listJobs: () => ipcRenderer.invoke(IPC.listJobs),
  cancelJob: (id) => ipcRenderer.invoke(IPC.cancelJob, id),
  removeJob: (id) => ipcRenderer.invoke(IPC.removeJob, id),
  retryJob: (id) => ipcRenderer.invoke(IPC.retryJob, id),
  findAgain: (id) => ipcRenderer.invoke(IPC.findAgain, id),
  rewritePosts: (id) => ipcRenderer.invoke(IPC.rewritePosts, id),
  renderClips: (jobId, clipIds) => ipcRenderer.invoke(IPC.renderClips, jobId, clipIds),
  deleteJob: (id) => ipcRenderer.invoke(IPC.deleteJob, id),
  deleteReel: (jobId, clipId) => ipcRenderer.invoke(IPC.deleteReel, jobId, clipId),
  setClipHeart: (jobId, clipId, hearted) => ipcRenderer.invoke(IPC.setClipHeart, jobId, clipId, hearted),
  deleteClips: (jobId, clipIds) => ipcRenderer.invoke(IPC.deleteClips, jobId, clipIds),
  setClipRange: (jobId, clipId, start, end) => ipcRenderer.invoke(IPC.setClipRange, jobId, clipId, start, end),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  openUploadPage: (platform) => ipcRenderer.invoke(IPC.openUploadPage, platform),
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  onJobUpdate: (cb) => {
    const listener = (_event: IpcRendererEvent, job: Job): void => cb(job)
    ipcRenderer.on(IPC.onJobUpdate, listener)
    return () => ipcRenderer.removeListener(IPC.onJobUpdate, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
