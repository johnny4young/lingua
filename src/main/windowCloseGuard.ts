import type { BrowserWindow } from 'electron';

type GuardedWindow = Pick<BrowserWindow, 'on'> & {
  webContents: Pick<BrowserWindow['webContents'], 'on' | 'send'>;
};

/**
 * Routes a close through the renderer's unsaved-changes prompt. A crashed
 * renderer can never answer, so that window (and only that window) closes
 * directly; later windows keep the prompt.
 */
export function installDirtyCloseGuard(
  window: GuardedWindow,
  shouldBypass: () => boolean
): void {
  let rendererGone = false;
  window.on('close', event => {
    if (rendererGone || shouldBypass()) return;
    event.preventDefault();
    window.webContents.send('app:before-close');
  });
  window.webContents.on('render-process-gone', () => {
    rendererGone = true;
  });
}
