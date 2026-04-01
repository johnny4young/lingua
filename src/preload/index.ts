import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('runlang', {
  platform: process.platform,

  // Go runner IPC
  go: {
    detect: () => ipcRenderer.invoke('go:detect'),
    compile: (sourceCode: string) => ipcRenderer.invoke('go:compile', sourceCode),
  },
});
