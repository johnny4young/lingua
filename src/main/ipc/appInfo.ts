import { app, shell } from 'electron';
import { typedHandle } from './typedHandle';
import { getBundledAppInfo, normalizeExternalUrl } from '../../shared/appInfo';

export function registerAppInfoHandlers(): void {
  typedHandle('app:get-info', () =>
    getBundledAppInfo({
      version: app.getVersion(),
    })
  );

  typedHandle('app:open-external', async (_event, url: unknown) => {
    const normalizedUrl = normalizeExternalUrl(url);
    if (normalizedUrl === null) {
      return false;
    }

    await shell.openExternal(normalizedUrl);
    return true;
  });
}
