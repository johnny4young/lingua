import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('runlang', {
  platform: process.platform,
});
