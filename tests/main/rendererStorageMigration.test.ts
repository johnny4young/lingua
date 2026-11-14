import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  migrateOrigin,
  runOriginMigration,
  type OriginMigrationMarker,
} from '@electron-stagewright/origin-migration';
import {
  migrateRendererStorage,
  ORIGIN_MIGRATION_MARKER,
  storageMigrationNoticeFor,
} from '../../src/main/rendererStorageMigration';
import { RENDERER_BLANK_URL } from '../../src/main/rendererProtocol';

vi.mock('@electron-stagewright/origin-migration', async importOriginal => ({
  ...(await importOriginal<typeof import('@electron-stagewright/origin-migration')>()),
  migrateOrigin: vi.fn(async () => ({ status: 'skipped' })),
}));

// Shaped like the markers builds before the package wrote.
function linguaMarker(overrides: Partial<OriginMigrationMarker>): OriginMigrationMarker {
  return {
    version: 1,
    state: 'done',
    attempts: 1,
    localStorageKeys: 4,
    files: 1,
    fileBytes: 2048,
    durationMs: 12,
    localStorageCopied: true,
    copiedFiles: ['sql/db.duckdb'],
    ...overrides,
  };
}

const unreachable = () => Promise.reject(new Error('page opened'));

describe('renderer storage migration wiring', () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'lingua-origin-'));
  });
  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  it('migrates to the blank renderer document and keeps the marker earlier builds wrote', async () => {
    const signal = new AbortController().signal;
    const options = {
      userDataDir,
      BrowserWindow: class {} as never,
      session: {} as never,
      onProgress: () => {},
      signal,
    };
    await migrateRendererStorage(options);
    expect(migrateOrigin).toHaveBeenCalledWith({
      ...options,
      targetUrl: RENDERER_BLANK_URL,
      markerFile: 'renderer-origin-migration.json',
    });
  });

  it('skips a profile an earlier build already migrated, without opening a page', async () => {
    await writeFile(
      path.join(userDataDir, ORIGIN_MIGRATION_MARKER),
      JSON.stringify(linguaMarker({}))
    );
    const result = await runOriginMigration({
      userDataDir,
      markerFile: ORIGIN_MIGRATION_MARKER,
      openLegacy: unreachable,
      openTarget: unreachable,
      flush: () => {},
    });
    expect(result).toEqual({ status: 'skipped' });
  });

  it('spends the last attempt an earlier build left, then tells the user it gave up', async () => {
    await writeFile(
      path.join(userDataDir, ORIGIN_MIGRATION_MARKER),
      JSON.stringify(linguaMarker({ state: 'failed', attempts: 2, error: 'ETIMEDOUT' }))
    );
    const result = await runOriginMigration({
      userDataDir,
      markerFile: ORIGIN_MIGRATION_MARKER,
      openLegacy: unreachable,
      openTarget: unreachable,
      flush: () => {},
    });
    expect(result).toMatchObject({ status: 'failed', final: true });
    expect(storageMigrationNoticeFor(result)).toBe('final');
    const marker = JSON.parse(
      await readFile(path.join(userDataDir, ORIGIN_MIGRATION_MARKER), 'utf8')
    ) as OriginMigrationMarker;
    expect(marker).toMatchObject({ attempts: 3, copiedFiles: ['sql/db.duckdb'] });
  });

  it('asks for a retry while attempts remain and stays quiet otherwise', () => {
    const marker = linguaMarker({ state: 'failed', attempts: 1 });
    expect(storageMigrationNoticeFor({ status: 'failed', marker, final: false })).toBe('retry');
    expect(storageMigrationNoticeFor({ status: 'migrated', marker })).toBeNull();
    expect(storageMigrationNoticeFor({ status: 'skipped' })).toBeNull();
  });
});
