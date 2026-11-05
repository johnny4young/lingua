import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStagedRowEdits, stagedRowEdits, type StagedRowEdits } from '../../../src/renderer/runtime/sqlStagedEdits';

const kept = { count: 1 } as StagedRowEdits;

const asksOnUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => {
  setStagedRowEdits(null);
  delete (window as { lingua?: unknown }).lingua;
  vi.restoreAllMocks();
});

describe('staged row edits outside the panel', () => {
  it('asks on a web unload only while something is staged', () => {
    (window as { lingua?: unknown }).lingua = { platform: 'web' };
    expect(asksOnUnload()).toBe(false);
    setStagedRowEdits(kept);
    expect(stagedRowEdits()).toBe(kept);
    expect(asksOnUnload()).toBe(true);
    setStagedRowEdits({ count: 2 } as StagedRowEdits);
    expect(asksOnUnload()).toBe(true);
    setStagedRowEdits(null);
    expect(asksOnUnload()).toBe(false);
  });

  it('leaves unload alone on desktop, where the close guard asks', () => {
    (window as { lingua?: unknown }).lingua = { platform: 'darwin' };
    setStagedRowEdits(kept);
    expect(asksOnUnload()).toBe(false);
  });
});
