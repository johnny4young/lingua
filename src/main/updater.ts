import { app, autoUpdater, BrowserWindow, ipcMain } from 'electron';

const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32']);
const UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

declare const __LINGUA_UPDATE_URL__: string;

let updateState: UpdateState = {
  status: 'unavailable',
  supported: false,
  enabled: false,
  message: 'Automatic updates are only available in packaged desktop builds.',
};

let registered = false;

function isoNow(): string {
  return new Date().toISOString();
}

function broadcastUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updates:state-changed', updateState);
  }
}

function setUpdateState(next: Partial<UpdateState>): void {
  updateState = { ...updateState, ...next };
  if (app.isReady()) {
    broadcastUpdateState();
  }
}

function startUpdater(): void {
  if (!app.isPackaged) {
    setUpdateState({
      status: 'unavailable',
      supported: false,
      enabled: false,
      message: 'Automatic updates are disabled in development builds.',
    });
    return;
  }

  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    setUpdateState({
      status: 'unavailable',
      supported: false,
      enabled: false,
      message: `Automatic updates are not supported on ${process.platform}.`,
    });
    return;
  }

  setUpdateState({
    status: 'idle',
    supported: true,
    enabled: true,
    message: 'Automatic updates are enabled for this packaged build.',
  });

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      message: 'Checking for updates...',
      lastCheckedAt: isoNow(),
    });
  });

  autoUpdater.on('update-available', () => {
    setUpdateState({
      status: 'available',
      message: 'Update available. Downloading...',
      lastCheckedAt: isoNow(),
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'not-available',
      message: 'You are up to date.',
      lastCheckedAt: isoNow(),
    });
  });

  autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName, _releaseDate, updateURL) => {
    setUpdateState({
      status: 'downloaded',
      message: 'An update has been downloaded and is ready to install.',
      releaseName,
      releaseNotes,
      updateURL,
      lastCheckedAt: isoNow(),
    });
  });

  autoUpdater.on('error', (error) => {
    setUpdateState({
      status: 'error',
      message: error?.message || 'Automatic update failed.',
      lastCheckedAt: isoNow(),
    });
  });

  const feedURL = `${__LINGUA_UPDATE_URL__}/update/${process.platform}/${app.getVersion()}`;
  autoUpdater.setFeedURL({ url: feedURL });

  // Initial check shortly after launch, then every hour
  setTimeout(() => autoUpdater.checkForUpdates(), 10_000);
  setInterval(() => autoUpdater.checkForUpdates(), UPDATE_INTERVAL_MS);
}

export function registerUpdater(): void {
  if (!registered) {
    ipcMain.handle('updates:get-state', async () => updateState);
    ipcMain.handle('updates:check', async () => {
      if (!updateState.enabled) return updateState;

      try {
        setUpdateState({
          status: 'checking',
          message: 'Checking for updates...',
          lastCheckedAt: isoNow(),
        });
        await autoUpdater.checkForUpdates();
      } catch (error) {
        setUpdateState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          lastCheckedAt: isoNow(),
        });
      }

      return updateState;
    });
    ipcMain.handle('updates:restart', async () => {
      if (updateState.status !== 'downloaded') return false;
      autoUpdater.quitAndInstall();
      return true;
    });
    registered = true;
  }

  if (app.isReady()) {
    startUpdater();
  } else {
    app.once('ready', startUpdater);
  }
}
