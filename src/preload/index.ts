import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('runlang', {
  platform: process.platform,

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

  // File system IPC
  fs: {
    selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
    selectFile: () => ipcRenderer.invoke('fs:select-file'),
    readdir: (dirPath: string) => ipcRenderer.invoke('fs:readdir', dirPath),
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
    read: (filePath: string) => ipcRenderer.invoke('fs:read', filePath),
    write: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:write', filePath, content),
    delete: (filePath: string, isDirectory?: boolean) =>
      ipcRenderer.invoke('fs:delete', filePath, isDirectory),
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
});
