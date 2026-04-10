import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerGoHandlers } from './go-compiler';
import { registerRustHandlers } from './rust-compiler';
import { registerFileSystemHandlers } from './ipc/fileSystem';
import { registerPluginHandlers } from './plugins';
import { registerUpdater } from './updater';

if (started) {
  app.quit();
}

// Register IPC handlers
registerGoHandlers();
registerRustHandlers();
registerFileSystemHandlers();
registerPluginHandlers();
registerUpdater();

const createWindow = () => {
  const rendererUrl =
    process.env.RUNLANG_RENDERER_URL ?? MAIN_WINDOW_VITE_DEV_SERVER_URL;
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'RunLang',
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

  // Show window once the renderer is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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
