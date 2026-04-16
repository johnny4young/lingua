import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerGoHandlers } from './go-compiler';
import { registerRustHandlers } from './rust-compiler';
import { registerAppInfoHandlers } from './ipc/appInfo';
import { registerFileSystemHandlers } from './ipc/fileSystem';
import { registerLocaleHandlers } from './ipc/locale';
import { registerPluginHandlers } from './plugins';
import { getTrustedRendererUrl, isAllowedNavigationTarget } from './security';
import { registerUpdater } from './updater';

if (started) {
  app.quit();
}

// Register IPC handlers
registerGoHandlers();
registerRustHandlers();
registerAppInfoHandlers();
registerFileSystemHandlers();
registerLocaleHandlers();
registerPluginHandlers();
registerUpdater();

let forceQuit = false;

ipcMain.on('app:force-close', () => {
  forceQuit = true;
  app.quit();
});

const createWindow = () => {
  const rendererUrl = getTrustedRendererUrl(
    process.env.LINGUA_RENDERER_URL ?? MAIN_WINDOW_VITE_DEV_SERVER_URL
  );
  const mainWindow = new BrowserWindow({
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

  // Dirty-close intercept: ask the renderer to check for unsaved tabs
  mainWindow.on('close', (event) => {
    if (forceQuit) return;
    event.preventDefault();
    mainWindow.webContents.send('app:before-close');
  });

  // Show window once the renderer is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigationTarget(targetUrl, rendererUrl)) {
      event.preventDefault();
    }
  });

  if (rendererUrl) {
    // Retry loading the dev server URL — Vite may not be ready yet
    const loadWithRetry = (retries = 30, delay = 1000) => {
      mainWindow.loadURL(rendererUrl).catch(() => {
        if (retries > 0) {
          setTimeout(() => loadWithRetry(retries - 1, delay), delay);
        } else {
          // Fallback: show the window even if loading failed
          mainWindow.show();
        }
      });
    };
    loadWithRetry();
  } else {
    mainWindow.loadFile(
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

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
