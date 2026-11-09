import { app, BrowserWindow, Menu, nativeImage, protocol, shell, Tray } from 'electron'
import { join } from 'node:path'
import { loadEngineList } from './engineList'
import { loadJobs } from './jobs'
import { serveMedia } from './media'
import { registerIpc } from './ipc'
import { initLogger, log } from './logger'
import { getSettings } from './settings'
import { ytDlpPath } from './youtube'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

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
    icon: appIcon(),
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

  win.on('close', (event) => {
    if (quitting || !getSettings().closeToTray) return
    event.preventDefault()
    win.hide()
    showTray()
  })

  // Windows logoff/shutdown: a hidden-instead-of-closed window would hold it up.
  win.on('session-end', () => {
    quitting = true
  })

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

function showWindow(): void {
  if (!mainWindow) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Tray (menu bar on macOS) icon, created the first time the window is closed to it. */
function showTray(): void {
  if (tray) return
  tray = new Tray(nativeImage.createFromPath(appIcon()).resize({ width: 16, height: 16 }))
  tray.setToolTip('Siftora')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Siftora', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  tray.on('click', showWindow)
}

/** Window and taskbar icon: the multi-size .ico on Windows, the 1024 px PNG elsewhere. */
function appIcon(): string {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return app.isPackaged ? join(process.resourcesPath, file) : join(app.getAppPath(), 'resources', file)
}

// Groups the taskbar button under our name and icon (in dev it would show Electron's).
if (process.platform === 'win32') app.setAppUserModelId('app.siftora')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  initLogger()
  log.info('main', `Siftora ${app.getVersion()} starting on ${process.platform}`)

  process.on('uncaughtException', (err) => {
    log.error('main', `uncaughtException: ${describe(err)}`)
  })

  process.on('unhandledRejection', (reason) => {
    log.error('main', `unhandledRejection: ${describe(reason)}`)
  })

  app.on('second-instance', showWindow)

  app.on('before-quit', () => {
    quitting = true
  })

  // siftora-media://local/<encoded path> lets the renderer play local videos (dev server or file://).
  protocol.registerSchemesAsPrivileged([
    { scheme: 'siftora-media', privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true } }
  ])

  app
    .whenReady()
    .then(() => {
      // macOS takes the Dock icon from the app bundle, which in dev is Electron's.
      if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(appIcon())
      protocol.handle('siftora-media', serveMedia)
      registerIpc()
      loadJobs()
      loadEngineList()
      // Only needed for video links, but the first link should not wait for it.
      ytDlpPath().catch((err: unknown) => log.warn('youtube', `could not download yt-dlp: ${describe(err)}`))
      createWindow()

      app.on('activate', showWindow)
    })
    .catch((err: unknown) => log.error('main', `Startup failed: ${describe(err)}`))

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
