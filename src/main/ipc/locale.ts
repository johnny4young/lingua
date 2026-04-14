import { app, ipcMain } from 'electron';

export function registerLocaleHandlers(): void {
  ipcMain.handle('app:get-system-languages', () =>
    app.getPreferredSystemLanguages()
  );
}
