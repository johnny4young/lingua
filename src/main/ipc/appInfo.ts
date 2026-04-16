import { app, ipcMain, shell } from 'electron';
import { canOpenExternalUrl, getBundledAppInfo } from '../../shared/appInfo';

export function registerAppInfoHandlers(): void {
  ipcMain.handle('app:get-info', () =>
    getBundledAppInfo({
      version: app.getVersion(),
    })
  );

  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (!canOpenExternalUrl(url)) {
      return false;
    }

    await shell.openExternal(url);
    return true;
  });
}
