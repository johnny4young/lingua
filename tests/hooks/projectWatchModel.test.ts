import { describe, expect, it } from 'vitest';
import {
  createWatchChangeBatch,
  queueWatchChange,
  takeWatchChanges,
} from '@/hooks/projectWatchModel';

function event(
  relativePath: string,
  eventType: string,
  rootId = 'root-a'
): FsChangedEvent {
  return { rootId, relativePath, eventType, filename: relativePath } as FsChangedEvent;
}

describe('projectWatchModel', () => {
  it('keeps a same-path structural event ahead of a later content event', () => {
    const batch = createWatchChangeBatch();
    queueWatchChange(batch, event('src/new.ts', 'rename'));
    queueWatchChange(batch, event('src/new.ts', 'change'));

    expect(takeWatchChanges(batch, 'root-a')).toEqual([
      { relativePath: 'src/new.ts', eventType: 'rename', filename: 'src/new.ts' },
    ]);
  });

  it('lets structural events replace content events', () => {
    const batch = createWatchChangeBatch();
    queueWatchChange(batch, event('src/file.ts', 'change'));
    queueWatchChange(batch, event('src/file.ts', 'rename'));

    expect(takeWatchChanges(batch, 'root-a')?.[0]?.eventType).toBe('rename');
  });

  it('drops the previous root and rejects stale batches after a project switch', () => {
    const batch = createWatchChangeBatch();
    queueWatchChange(batch, event('a.ts', 'rename', 'root-a'));
    queueWatchChange(batch, event('b.ts', 'rename', 'root-b'));

    expect(takeWatchChanges(batch, 'root-a')).toBeNull();
    expect(batch.rootId).toBeNull();
    expect(batch.changes.size).toBe(0);
  });
});
