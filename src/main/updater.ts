import { app, autoUpdater, BrowserWindow, ipcMain } from 'electron';

const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32']);
const UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

declare const __LINGUA_UPDATE_URL__: string;

/**
 * Resolve the auto-update feed URL from the build-time `__LINGUA_UPDATE_URL__`
 * define. Returns `null` when the configured base is missing, malformed, or
 * uses a non-HTTPS scheme so the updater fails closed instead of fetching
 * release manifests over plaintext or from an unintended origin.
 */
export function resolveUpdateFeedUrl(
  base: string | undefined,
  platform: string,
  version: string
): string | null {
  if (typeof base !== 'string' || base.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;

  const trimmedBase = base.replace(/\/+$/u, '');
  const safePlatform = encodeURIComponent(platform);
  const safeVersion = encodeURIComponent(version);
  return `${trimmedBase}/update/${safePlatform}/${safeVersion}`;
}

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

function isTerminalOrInFlightUpdateStatus(status: UpdateState['status']): boolean {
  return status === 'downloaded' || status === 'available';
}

function markCheckingForUpdates(): void {
  if (isTerminalOrInFlightUpdateStatus(updateState.status)) {
    setUpdateState({ lastCheckedAt: isoNow() });
    return;
  }

  setUpdateState({
    status: 'checking',
    message: 'Checking for updates...',
    lastCheckedAt: isoNow(),
  });
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

  autoUpdater.on('checking-for-update', markCheckingForUpdates);

  autoUpdater.on('update-available', () => {
    setUpdateState({
      status: 'available',
      message: 'Update available. Downloading...',
      lastCheckedAt: isoNow(),
    });
  });

  autoUpdater.on('update-not-available', () => {
    // Once we have an update staged ('available' = in-flight download,
    // 'downloaded' = ready to install), Squirrel's "no new update"
    // response is relative to the STAGED version, not the running
    // binary. Letting it overwrite the terminal state means the
    // hourly poll quietly strands the user on the old build: the
    // Restart-to-update affordance disables, and `releaseName` is
    // left dangling so Settings reads "UP TO DATE / vN" while the
    // running UI is still vN-1. Preserve the terminal state.
    if (isTerminalOrInFlightUpdateStatus(updateState.status)) {
      setUpdateState({ lastCheckedAt: isoNow() });
      return;
    }
    setUpdateState({
      status: 'not-available',
      message: 'You are up to date.',
      lastCheckedAt: isoNow(),
      releaseName: undefined,
      releaseNotes: undefined,
      updateURL: undefined,
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

  const feedURL = resolveUpdateFeedUrl(
    __LINGUA_UPDATE_URL__,
    process.platform,
    app.getVersion()
  );
  if (!feedURL) {
    setUpdateState({
      status: 'unavailable',
      supported: false,
      enabled: false,
      message: 'Automatic updates are disabled (invalid update endpoint).',
    });
    return;
  }
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
        markCheckingForUpdates();
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
      // Defensive recovery: even when local `updateState.status` is
      // not 'downloaded' (e.g. it was lost to a future state-machine
      // bug), `autoUpdater.quitAndInstall()` is safe to call — Squirrel
      // no-ops when no staged install exists. We attempt the install
      // and only short-circuit when the platform clearly cannot
      // perform one. Returning `false` silently from the prior code
      // path masked exactly the kind of regression we just fixed.
      if (!updateState.enabled) return false;
      try {
        autoUpdater.quitAndInstall();
        return true;
      } catch {
        return false;
      }
    });
    registered = true;
  }

  if (app.isReady()) {
    startUpdater();
  } else {
    app.once('ready', startUpdater);
  }
}
