import { app, BrowserWindow, protocol, shell } from 'electron'
import { join } from 'node:path'
import { loadJobs } from './jobs'
import { serveMedia } from './media'
import { registerIpc } from './ipc'
import { initLogger, log } from './logger'

let mainWindow: BrowserWindow | null = null

function describe(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

function openExternal(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    void shell.openExternal(url)
  }
}

function isInternalUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl) return url.startsWith('file://')

  try {
    return new URL(url).origin === new URL(devUrl).origin
  } catch {
    return false
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow = win

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return
    event.preventDefault()
    openExternal(url)
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  const loading = devUrl
    ? win.loadURL(devUrl)
    : win.loadFile(join(__dirname, '../renderer/index.html'))

  loading.catch((err: unknown) => log.error('main', `Failed to load renderer: ${describe(err)}`))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  initLogger()
  log.info('main', `Viral Clip Finder ${app.getVersion()} starting on ${process.platform}`)

  process.on('uncaughtException', (err) => {
    log.error('main', `uncaughtException: ${describe(err)}`)
  })

  process.on('unhandledRejection', (reason) => {
    log.error('main', `unhandledRejection: ${describe(reason)}`)
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // vcf-media://local/<encoded path> lets the renderer play local videos (dev server or file://).
  protocol.registerSchemesAsPrivileged([
    { scheme: 'vcf-media', privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true } }
  ])

  app
    .whenReady()
    .then(() => {
      protocol.handle('vcf-media', serveMedia)
      registerIpc()
      loadJobs()
      createWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((err: unknown) => log.error('main', `Startup failed: ${describe(err)}`))

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
