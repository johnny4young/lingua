import { app, BrowserWindow } from 'electron';
import { typedHandle } from './ipc/typedHandle';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';

// electron-updater auto-installs from the platform's updater-native format:
// macOS (zip / Squirrel.Mac), Windows (NSIS), and Linux (AppImage). The feed
// itself is read from the `app-update.yml` electron-builder bakes in from the
// GitHub `publish` provider, so there is no feed URL to configure here.
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32', 'linux']);
const UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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

/** UpdateInfo carries `version` plus an optional human `releaseName`. */
function resolveReleaseName(info: UpdateInfo): string {
  return info.releaseName?.trim() || info.version;
}

/** electron-updater release notes can be a string, a per-version array, or null. */
function resolveReleaseNotes(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes;
  if (typeof notes === 'string' && notes.length > 0) return notes;
  if (Array.isArray(notes)) {
    const joined = notes
      .map((entry) => entry.note ?? '')
      .filter((note) => note.length > 0)
      .join('\n\n');
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
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

  // Download in the background and stage the install for the next quit; the
  // user still gets an explicit "Restart to update" affordance.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', markCheckingForUpdates);

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setUpdateState({
      status: 'available',
      message: 'Update available. Downloading...',
      releaseName: resolveReleaseName(info),
      lastCheckedAt: isoNow(),
    });
  });

  autoUpdater.on('update-not-available', () => {
    // Once an update is staged ('available' = in-flight download, 'downloaded'
    // = ready to install), a later "no new update" response is relative to the
    // STAGED version, not the running binary. Overwriting the terminal state
    // would strand the user on the old build, so preserve it.
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

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setUpdateState({
      status: 'available',
      message: `Downloading update... ${Math.round(progress.percent)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setUpdateState({
      status: 'downloaded',
      message: 'An update has been downloaded and is ready to install.',
      releaseName: resolveReleaseName(info),
      releaseNotes: resolveReleaseNotes(info),
      lastCheckedAt: isoNow(),
    });
  });

  autoUpdater.on('error', (error: Error) => {
    setUpdateState({
      status: 'error',
      message: error?.message || 'Automatic update failed.',
      lastCheckedAt: isoNow(),
    });
  });

  // Initial check shortly after launch, then every hour. checkForUpdates()
  // rejects on a transient network/feed error — funnel that into the error
  // state instead of an unhandled rejection.
  const runCheck = () => {
    void autoUpdater.checkForUpdates()?.catch((error: unknown) => {
      setUpdateState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        lastCheckedAt: isoNow(),
      });
    });
  };
  setTimeout(runCheck, 10_000);
  setInterval(runCheck, UPDATE_INTERVAL_MS);
}

export function registerUpdater(): void {
  if (!registered) {
    typedHandle('updates:get-state', async () => updateState);
    typedHandle('updates:check', async () => {
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
    typedHandle('updates:restart', async () => {
      // Defensive recovery: even when local `updateState.status` is not
      // 'downloaded' (e.g. lost to a future state-machine bug),
      // `quitAndInstall()` is safe — electron-updater no-ops when no staged
      // install exists. Only short-circuit when updates are disabled outright.
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
