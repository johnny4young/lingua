import type { BrowserWindow as BrowserWindowType, Session } from 'electron';
import {
  migrateOrigin,
  type OriginMigrationResult,
} from '@electron-stagewright/origin-migration';
import type { StorageMigrationNotice } from '../shared/ipcContract';
import { RENDERER_BLANK_URL } from './rendererProtocol';

/** The marker name builds before the package wrote; renaming it would copy again. */
export const ORIGIN_MIGRATION_MARKER = 'renderer-origin-migration.json';

export function migrateRendererStorage(options: {
  userDataDir: string;
  BrowserWindow: typeof BrowserWindowType;
  session: Session;
  onProgress: (done: number, total: number) => void;
  signal: AbortSignal;
}): Promise<OriginMigrationResult> {
  return migrateOrigin({
    ...options,
    targetUrl: RENDERER_BLANK_URL,
    markerFile: ORIGIN_MIGRATION_MARKER,
  });
}

/** What to tell the user after an attempt: nothing, a retry next launch, or that it gave up. */
export function storageMigrationNoticeFor(
  result: OriginMigrationResult
): StorageMigrationNotice | null {
  if (result.status !== 'failed') return null;
  return result.final ? 'final' : 'retry';
}
