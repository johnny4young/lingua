import { app, BrowserWindow, ipcMain, session } from 'electron';
import { typedHandle } from './ipc/typedHandle';
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
import { installPermissionHandlers } from './permissionHandlers';
import {
  readConsentMirror,
  registerConsentHandlers,
  resolveConsentMirrorPath,
} from './ipc/consent';
import { registerFormatterHandlers } from './formatters';
import { registerGoHandlers } from './go-compiler';
import { registerRustHandlers } from './rust-compiler';
import { registerRubyHandlers } from './ruby-runner';
import { registerNodeJSHandlers } from './node-runner';
import { registerAltJsRuntimeHandlers } from './altJsRuntimes';
import { registerAppInfoHandlers } from './ipc/appInfo';
import { registerFileSystemHandlers } from './ipc/fileSystem';
import { registerLocaleHandlers } from './ipc/locale';
import { registerDesktopSmokeHandlers } from './ipc/desktopSmoke';
import { registerEnvHandlers } from './ipc/env';
import { registerLspHandlers, disposeLspBridge } from './ipc/lsp';
import { registerProfileHandlers } from './ipc/profile';
import { registerRecoveryHandlers } from './ipc/recovery';
import { registerDependencyHandlers } from './ipc/dependencies';
import { registerGitHandlers } from './ipc/git';
import { registerPluginHandlers } from './plugins';
import { getTrustedRendererUrl, isAllowedNavigationTarget } from './security';
import { registerUpdater } from './updater';
import { createLicenseRuntime, parseEmbeddedPublicKey } from './license';
import { registerLicenseHandlers } from './ipc/license';
import { installOfflineSmokeFilter, isOfflineSmokeRequested } from './offlineSmoke';

// Desktop smoke / Stagewright launches must not contend with an already-open
// installed Lingua.app for Electron's single-instance lock. The harnesses set
// this to an artifact-local directory before `requestSingleInstanceLock()` so
// validation can run alongside a user's real app without touching their data.
const smokeUserDataDir = process.env.LINGUA_SMOKE_USER_DATA_DIR?.trim();
if (smokeUserDataDir) {
  app.setPath('userData', smokeUserDataDir);
}

// No Squirrel boot hook: electron-builder ships an NSIS installer on Windows
// (not Squirrel.Windows), so the app is never invoked with `--squirrel-*`
// args. Windows auto-update is handled by electron-updater (see ./updater).

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

// Register IPC handlers
registerGoHandlers();
registerRustHandlers();
registerRubyHandlers();
registerNodeJSHandlers();
registerAltJsRuntimeHandlers();
registerFormatterHandlers();
registerAppInfoHandlers();
registerDesktopSmokeHandlers();
registerEnvHandlers();
registerFileSystemHandlers();
registerLocaleHandlers();
registerLspHandlers();
registerPluginHandlers();
registerProfileHandlers();
registerRecoveryHandlers();
registerDependencyHandlers();
registerGitHandlers();
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

typedHandle('app:consume-pending-deep-link', () => consumePendingDeepLink(deepLinkState));
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
      // internal — pin the same-origin policy explicitly. This is the
      // Electron default, but pinning it ensures a future edit cannot
      // silently disable web security (which would let a compromised
      // renderer bypass CORS and read cross-origin resources).
      webSecurity: true,
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

  // The intercept above waits for the renderer's `app:force-close`
  // answer. A crashed or killed renderer (OOM during a heavy WASM run,
  // GPU wedge) can never answer, which would leave the window — and
  // `app.quit()` / the updater's `quitAndInstall()` — blocked forever
  // behind the preventDefault(). Once the renderer process is gone there
  // are no unsaved-changes semantics left to protect; let close proceed.
  window.webContents.on('render-process-gone', () => {
    forceQuit = true;
  });
  window.webContents.on('unresponsive', () => {
    // Unresponsive is recoverable (Electron pairs it with `responsive`),
    // so don't flip forceQuit here — but log it for diagnosis.
    console.warn('[lingua] renderer became unresponsive');
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
  // Server-issued 3xx redirects fire `will-redirect`, which `will-navigate`
  // does not cover — gate them with the identical allowlist so a redirect
  // cannot reach an origin a direct navigation would be denied.
  window.webContents.on('will-redirect', (event, targetUrl) => {
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
  // implementation detail — deny-by-default permission posture. Install before any
  // window loads so the very first renderer request is already gated. Only the
  // main-frame clipboard read/write grants in `permissionHandlers` are allowed;
  // media / geolocation / notifications / subframe requests / etc. are refused.
  installPermissionHandlers(session.defaultSession);

  // implementation — install the offline-smoke webRequest filter
  // before any window loads, so the very first renderer request is
  // already gated. Production sessions never set the env var.
  if (isOfflineSmokeRequested()) {
    installOfflineSmokeFilter(session.defaultSession);
  }

  const userDataDir = app.getPath('userData');
  const mirrorPath = resolveConsentMirrorPath(userDataDir);
  // Register the IPC writer first so the renderer's `setTelemetryConsent`
  // always has a live handler by the time the window loads.
  registerConsentHandlers(mirrorPath);
  // Boot the crash reporter BEFORE `createWindow()` so the reporter is
  // attached for the renderer process from its first tick — fixes the
  // internal early-crash-coverage gap the staged-diff review flagged.
  await bootCrashReporter({
    appVersion: app.getVersion(),
    readConsentAtBoot: () => readConsentMirror(mirrorPath),
  });

  // internal — start the internal runtime before the window, but do not keep its
  // disk read + token verification on the first-paint critical path. The IPC
  // handlers register synchronously against the shared promise; a renderer
  // getState call that wins the race waits for the verified snapshot instead
  // of observing an unregistered channel or a free-tier sentinel.
  const licenseRuntime = createLicenseRuntime({
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

app.on('before-quit', () => {
  // implementation — make sure desktop LSP children do not outlive
  // Lingua's main process.
  disposeLspBridge();
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
