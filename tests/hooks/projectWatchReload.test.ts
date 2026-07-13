import { describe, expect, it } from 'vitest';
import { findReloadTargetId } from '@/hooks/projectWatchReload';

const tabs = [
  { id: 'tab-a', rootId: 'root-a', relativePath: 'src/a.ts' },
  { id: 'tab-b', rootId: 'root-b', relativePath: 'src/a.ts' },
];

function event(
  overrides: Partial<{
    rootId: string;
    relativePath: string;
    eventType: string;
    filename: string | null;
  }> = {}
): FsChangedEvent {
  return {
    rootId: 'root-a',
    relativePath: 'src/a.ts',
    eventType: 'change',
    filename: 'a.ts',
    ...overrides,
  } as FsChangedEvent;
}

describe('findReloadTargetId', () => {
  it('matches open tabs by root capability and relative path', () => {
    expect(findReloadTargetId(event(), tabs)).toBe('tab-a');
    expect(findReloadTargetId(event({ rootId: 'root-b' }), tabs)).toBe('tab-b');
    expect(findReloadTargetId(event({ relativePath: 'src/missing.ts' }), tabs)).toBeNull();
  });

  it('rejects structural and filename-less events', () => {
    expect(findReloadTargetId(event({ eventType: 'rename' }), tabs)).toBeNull();
    expect(findReloadTargetId(event({ filename: null }), tabs)).toBeNull();
  });
});
