import { app, ipcMain, shell } from 'electron';
import { getBundledAppInfo, normalizeExternalUrl } from '../../shared/appInfo';

export function registerAppInfoHandlers(): void {
  ipcMain.handle('app:get-info', () =>
    getBundledAppInfo({
      version: app.getVersion(),
    })
  );

  ipcMain.handle('app:open-external', async (_event, url: unknown) => {
    const normalizedUrl = normalizeExternalUrl(url);
    if (normalizedUrl === null) {
      return false;
    }

    await shell.openExternal(normalizedUrl);
    return true;
  });
}
