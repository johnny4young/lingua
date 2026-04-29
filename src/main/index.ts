import { app, BrowserWindow, ipcMain } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { extractLinguaDeepLinkUrl, type DeepLinkTarget } from '../shared/deepLinks';
import {
  consumePendingDeepLink,
  createDeepLinkRuntimeState,
  handleIncomingDeepLink,
  markDeepLinkRendererReady,
  primeDeepLinkFromArgv,
} from './deepLinkState';
import { bootCrashReporter } from './crashReporter';
import {
  readConsentMirror,
  registerConsentHandlers,
  resolveConsentMirrorPath,
} from './ipc/consent';
import { registerFormatterHandlers } from './formatters';
import { registerGoHandlers } from './go-compiler';
import { registerRustHandlers } from './rust-compiler';
import { registerAppInfoHandlers } from './ipc/appInfo';
import { registerFileSystemHandlers } from './ipc/fileSystem';
import { registerLocaleHandlers } from './ipc/locale';
import { registerDesktopSmokeHandlers } from './ipc/desktopSmoke';
import { registerEnvHandlers } from './ipc/env';
import { registerPluginHandlers } from './plugins';
import { getTrustedRendererUrl, isAllowedNavigationTarget } from './security';
import { registerUpdater } from './updater';
import { createLicenseRuntime, parseEmbeddedPublicKey } from './license';
import { registerLicenseHandlers } from './ipc/license';

/**
 * Squirrel.Windows installer / uninstaller lifecycle hook. The
 * `electron-squirrel-startup` package emits `true` when Electron is
 * being invoked by Squirrel with the `--squirrel-install` /
 * `--squirrel-updated` / `--squirrel-uninstall` / `--squirrel-obsolete`
 * args, in which case the app should quit immediately.
 *
 * Wrapped in a runtime require gated on `process.platform === 'win32'`
 * because:
 *   1. Squirrel only matters on Windows; macOS + Linux artifacts have
 *      no use for the module and packaging it into their bundles is
 *      pure overhead.
 *   2. Forge's vite plugin marks the module as external, and the
 *      packager occasionally fails to copy it into `app.asar` on
 *      macOS / Linux. A static `import` would crash the main process
 *      at startup with `Cannot find module 'electron-squirrel-startup'`
 *      before any window is shown. The defensive try/catch keeps the
 *      app booting even if Forge regresses again, on any platform.
 */
function consumeSquirrelStartup(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const requireFromHere = createRequire(import.meta.url);
    return Boolean(requireFromHere('electron-squirrel-startup'));
  } catch {
    return false;
  }
}

if (consumeSquirrelStartup()) {
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// Register IPC handlers
registerGoHandlers();
registerRustHandlers();
registerFormatterHandlers();
registerAppInfoHandlers();
registerDesktopSmokeHandlers();
registerEnvHandlers();
registerFileSystemHandlers();
registerLocaleHandlers();
registerPluginHandlers();
registerUpdater();

let forceQuit = false;
let mainWindow: BrowserWindow | null = null;
const deepLinkState = createDeepLinkRuntimeState();

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

function dispatchDeepLinkToRenderer(target: DeepLinkTarget): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  mainWindow.webContents.send('app:deep-link', target);
  return true;
}

function handleDeepLink(rawUrl: string) {
  const target = handleIncomingDeepLink(deepLinkState, rawUrl, dispatchDeepLinkToRenderer);
  if (!target) {
    return;
  }

  focusMainWindow();
}

function registerProtocolClient() {
  if (!app.isPackaged && !process.defaultApp) {
    return;
  }

  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('lingua', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    return;
  }

  app.setAsDefaultProtocolClient('lingua');
}

ipcMain.on('app:force-close', () => {
  forceQuit = true;
  app.quit();
});

ipcMain.handle('app:consume-pending-deep-link', () => consumePendingDeepLink(deepLinkState));
ipcMain.on('app:deep-link-renderer-ready', () => {
  markDeepLinkRendererReady(deepLinkState, true);
});

const createWindow = () => {
  const rendererUrl = getTrustedRendererUrl(
    process.env.LINGUA_RENDERER_URL ?? MAIN_WINDOW_VITE_DEV_SERVER_URL
  );
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'Lingua',
    titleBarStyle: 'hiddenInset',
    show: false, // Show only when content is ready to avoid white flash
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  markDeepLinkRendererReady(deepLinkState, false);

  // Dirty-close intercept: ask the renderer to check for unsaved tabs
  window.on('close', (event) => {
    if (forceQuit) return;
    event.preventDefault();
    window.webContents.send('app:before-close');
  });

  // Show window once the renderer is ready
  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    markDeepLinkRendererReady(deepLinkState, false);
    mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigationTarget(targetUrl, rendererUrl)) {
      event.preventDefault();
    }
  });

  if (rendererUrl) {
    // Retry loading the dev server URL — Vite may not be ready yet
    const loadWithRetry = (retries = 30, delay = 1000) => {
      window.loadURL(rendererUrl).catch(() => {
        if (retries > 0) {
          setTimeout(() => loadWithRetry(retries - 1, delay), delay);
        } else {
          // Fallback: show the window even if loading failed
          window.show();
        }
      });
    };
    loadWithRetry();
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // DevTools available via Cmd+Option+I but not opened automatically
};

const requestAppQuit = () => {
  if (app.isReady()) {
    app.quit();
    return;
  }

  app.once('ready', () => {
    app.quit();
  });
};

process.once('SIGINT', requestAppQuit);
process.once('SIGTERM', requestAppQuit);

primeDeepLinkFromArgv(deepLinkState, process.argv);

app.on('second-instance', (_event, argv) => {
  focusMainWindow();
  const deepLinkUrl = extractLinguaDeepLinkUrl(argv);
  if (deepLinkUrl) {
    handleDeepLink(deepLinkUrl);
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on('ready', async () => {
  const userDataDir = app.getPath('userData');
  const mirrorPath = resolveConsentMirrorPath(userDataDir);
  // Register the IPC writer first so the renderer's `setTelemetryConsent`
  // always has a live handler by the time the window loads.
  registerConsentHandlers(mirrorPath);
  // Boot the crash reporter BEFORE `createWindow()` so the reporter is
  // attached for the renderer process from its first tick — fixes the
  // RL-067 early-crash-coverage gap the staged-diff review flagged.
  await bootCrashReporter({
    appVersion: app.getVersion(),
    readConsentAtBoot: () => readConsentMirror(mirrorPath),
  });

  // RL-059 main-side license runtime — boots before the window so the
  // first `getState` call from the renderer always sees the verified
  // snapshot instead of a free-tier sentinel.
  const licenseRuntime = await createLicenseRuntime({
    userDataDir,
    publicKeyJwk: parseEmbeddedPublicKey(__LINGUA_LICENSE_PUBLIC_KEY_JWK__),
  });
  registerLicenseHandlers(licenseRuntime);

  registerProtocolClient();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    return;
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
