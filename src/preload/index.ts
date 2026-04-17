import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lingua', {
  platform: process.platform,

  getSystemLanguages: () =>
    ipcRenderer.invoke('app:get-system-languages') as Promise<string[]>,
  getAppInfo: () => ipcRenderer.invoke('app:get-info') as Promise<AppInfo>,
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<boolean>,

  deepLinks: {
    consumePending: () =>
      ipcRenderer.invoke('app:consume-pending-deep-link') as Promise<DeepLinkTarget | null>,
    markReady: () => ipcRenderer.send('app:deep-link-renderer-ready'),
    onLink: (callback: (target: DeepLinkTarget) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as DeepLinkTarget);
      ipcRenderer.on('app:deep-link', handler);
      return () => ipcRenderer.removeListener('app:deep-link', handler);
    },
  },

  // Go runner IPC
  go: {
    detect: () => ipcRenderer.invoke('go:detect'),
    compile: (sourceCode: string) => ipcRenderer.invoke('go:compile', sourceCode),
  },

  // Rust runner IPC
  rust: {
    detect: () => ipcRenderer.invoke('rust:detect'),
    run: (sourceCode: string) => ipcRenderer.invoke('rust:run', sourceCode),
  },

  // Formatter IPC — gofmt / rustfmt pipe source via stdin
  format: {
    gofmt: (source: string) =>
      ipcRenderer.invoke('format:gofmt', source) as Promise<FormatIpcResult>,
    rustfmt: (source: string) =>
      ipcRenderer.invoke('format:rustfmt', source) as Promise<FormatIpcResult>,
  },

  // App lifecycle IPC
  confirmClose: (dirtyFileNames: string[], language?: string) =>
    ipcRenderer.invoke('app:confirm-close', dirtyFileNames, language) as Promise<number>,
  confirmCloseTab: (fileName: string, language?: string) =>
    ipcRenderer.invoke('app:confirm-close-tab', fileName, language) as Promise<number>,
  onBeforeClose: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('app:before-close', handler);
    return () => ipcRenderer.removeListener('app:before-close', handler);
  },
  forceClose: () => ipcRenderer.send('app:force-close'),

  // File system IPC
  fs: {
    selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
    selectFile: () => ipcRenderer.invoke('fs:select-file'),
    saveDialog: (defaultName: string, defaultDir?: string) =>
      ipcRenderer.invoke('fs:save-dialog', defaultName, defaultDir) as Promise<string | null>,
    readdir: (dirPath: string) => ipcRenderer.invoke('fs:readdir', dirPath),
    listAllFiles: (rootPath: string) => ipcRenderer.invoke('fs:listAllFiles', rootPath),
    searchInFiles: (rootPath: string, query: string, options?: FsSearchOptions) =>
      ipcRenderer.invoke('fs:searchInFiles', rootPath, query, options) as Promise<
        FsSearchResult[]
      >,
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
    read: (filePath: string) => ipcRenderer.invoke('fs:read', filePath),
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:write', filePath, content),
    delete: (filePath: string, isDirectory?: boolean, language?: string) =>
      ipcRenderer.invoke('fs:delete', filePath, isDirectory, language),
    rename: (oldPath: string, newName: string) =>
      ipcRenderer.invoke('fs:rename', oldPath, newName),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    touch: (filePath: string) => ipcRenderer.invoke('fs:touch', filePath),
    watchStart: (dirPath: string) =>
      ipcRenderer.invoke('fs:watch-start', dirPath),
    watchStop: (watchId: string) =>
      ipcRenderer.invoke('fs:watch-stop', watchId),
    onChanged: (
      callback: (event: {
        dirPath: string;
        eventType: string;
        filename: string | null;
      }) => void
    ) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(
          data as { dirPath: string; eventType: string; filename: string | null }
        );
      ipcRenderer.on('fs:changed', handler);
      return () => ipcRenderer.removeListener('fs:changed', handler);
    },
  },

  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    restartToApply: () => ipcRenderer.invoke('updates:restart'),
    onStateChanged: (callback: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as UpdateState);
      ipcRenderer.on('updates:state-changed', handler);
      return () => ipcRenderer.removeListener('updates:state-changed', handler);
    },
  },

  plugins: {
    getInstallDirectory: () => ipcRenderer.invoke('plugins:get-install-directory'),
    list: () => ipcRenderer.invoke('plugins:list'),
  },

  desktopSmoke: {
    enabled: process.env.LINGUA_DESKTOP_SMOKE === '1',
    getConfig: () => ipcRenderer.invoke('desktop-smoke:get-config') as Promise<DesktopSmokeConfig | null>,
    capture: (name: string) => ipcRenderer.invoke('desktop-smoke:capture', name) as Promise<string | null>,
    writeJsonArtifact: (name: string, payload: unknown) =>
      ipcRenderer.invoke('desktop-smoke:write-json-artifact', name, payload) as Promise<string | null>,
    finish: (success: boolean) => ipcRenderer.send('desktop-smoke:finish', success),
  },
});
