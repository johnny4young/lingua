import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { LegacyOriginReader, TargetOriginWriter } from './originMigration';
import {
  ABORT_FILE,
  BEGIN_FILE,
  call,
  END_FILE,
  FILE_SIZE,
  LIST_FILES,
  READ_CHUNK,
  READ_LOCAL_STORAGE,
  WRITE_CHUNK,
  WRITE_LOCAL_STORAGE,
} from './originMigrationScripts';

/** Bounds each page load and script; a stalled step fails the attempt instead of the launch. */
export const ORIGIN_PAGE_STEP_TIMEOUT_MS = 30_000;

type WindowFactory = new (options: BrowserWindowConstructorOptions) => BrowserWindow;

interface StoragePage {
  evaluate: <T>(script: string) => Promise<T>;
  close: () => void;
}

function withTimeout<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fail = (reason: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(reason);
    };
    const onAbort = () => fail(signal?.reason);
    const timer = setTimeout(
      () => fail(Object.assign(new Error('Origin migration step timed out'), { code: 'ETIMEDOUT' })),
      ORIGIN_PAGE_STEP_TIMEOUT_MS
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    promise.then(value => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    }, fail);
  });
}

async function openStoragePage(
  Window: WindowFactory,
  load: (window: BrowserWindow) => Promise<void>,
  cleanup: () => void,
  signal?: AbortSignal
): Promise<StoragePage> {
  const window = new Window({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  const close = () => {
    if (!window.isDestroyed()) window.destroy();
    cleanup();
  };
  try {
    await withTimeout(load(window), signal);
  } catch (error) {
    close();
    throw error;
  }
  return {
    evaluate: async <T>(script: string) => {
      const result = (await withTimeout(
        window.webContents.executeJavaScript(settled(script)) as Promise<SettledStep<T>>,
        signal
      )) as SettledStep<T>;
      if ('value' in result) return result.value;
      throw Object.assign(new Error('Origin page step failed'), { name: result.name });
    },
    close,
  };
}

type SettledStep<T> = { value: T } | { name: string };

// executeJavaScript rejects with neither name nor message, so the page reports the error name itself.
function settled(script: string): string {
  return `(async () => { try { return { value: await (${script}) }; } catch (error) { return { name: String((error && error.name) || 'Error') }; } })()`;
}

/** Reads the file:// origin through an empty page written to a private temp folder. */
export async function openLegacyOriginPage(
  Window: WindowFactory,
  signal?: AbortSignal
): Promise<LegacyOriginReader> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'lingua-origin-'));
  const document = path.join(folder, 'blank.html');
  const removeFolder = () => void rm(folder, { recursive: true, force: true }).catch(() => {});
  try {
    await writeFile(document, '<!doctype html><meta charset="utf-8"><title></title>');
  } catch (error) {
    removeFolder();
    throw error;
  }
  const page = await openStoragePage(Window, w => w.loadFile(document), removeFolder, signal);
  return {
    readLocalStorage: () => page.evaluate(READ_LOCAL_STORAGE),
    listFiles: () => page.evaluate(LIST_FILES),
    readChunk: (filePath, offset, length) =>
      page.evaluate(call(READ_CHUNK, filePath, offset, length)),
    close: page.close,
  };
}

export async function openTargetOriginPage(
  Window: WindowFactory,
  blankUrl: string,
  signal?: AbortSignal
): Promise<TargetOriginWriter> {
  const page = await openStoragePage(Window, w => w.loadURL(blankUrl), () => {}, signal);
  return {
    writeLocalStorage: entries => page.evaluate(call(WRITE_LOCAL_STORAGE, entries)),
    fileSize: filePath => page.evaluate(call(FILE_SIZE, filePath)),
    beginFile: filePath => page.evaluate(call(BEGIN_FILE, filePath)),
    writeChunk: bytes =>
      page.evaluate(
        call(WRITE_CHUNK, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'))
      ),
    endFile: () => page.evaluate(END_FILE),
    abortFile: () => page.evaluate(ABORT_FILE),
    close: page.close,
  };
}
