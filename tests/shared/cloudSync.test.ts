import { describe, expect, it, vi } from 'vitest';
import {
  mergeSnapshots,
  pruneTombstones,
  syncOnce,
  type SyncSnapshot,
  type SyncTransport,
} from '../../src/shared/cloudSync';

describe('mergeSnapshots', () => {
  it('takes local-only and remote-only keys as-is', () => {
    const local: SyncSnapshot = { a: { value: 1, updatedAt: 10 } };
    const remote: SyncSnapshot = { b: { value: 2, updatedAt: 20 } };
    const { merged, conflicts } = mergeSnapshots(local, remote);
    expect(merged).toEqual({ a: { value: 1, updatedAt: 10 }, b: { value: 2, updatedAt: 20 } });
    expect(conflicts).toEqual([]);
  });

  it('picks the newer entry per key (last-write-wins)', () => {
    const local: SyncSnapshot = { a: { value: 'old', updatedAt: 10 } };
    const remote: SyncSnapshot = { a: { value: 'new', updatedAt: 20 } };
    const { merged, conflicts } = mergeSnapshots(local, remote);
    expect(merged.a).toEqual({ value: 'new', updatedAt: 20 });
    expect(conflicts).toEqual([
      { key: 'a', winner: 'remote', localUpdatedAt: 10, remoteUpdatedAt: 20 },
    ]);
  });

  it('prefers local on a timestamp tie', () => {
    const local: SyncSnapshot = { a: { value: 'local', updatedAt: 10 } };
    const remote: SyncSnapshot = { a: { value: 'remote', updatedAt: 10 } };
    const { merged, conflicts } = mergeSnapshots(local, remote);
    expect(merged.a.value).toBe('local');
    expect(conflicts[0]?.winner).toBe('local');
  });

  it('does not record a conflict when both sides are identical', () => {
    const snap: SyncSnapshot = { a: { value: 1, updatedAt: 10 } };
    const { conflicts, changedFromRemote } = mergeSnapshots(snap, { a: { value: 1, updatedAt: 10 } });
    expect(conflicts).toEqual([]);
    expect(changedFromRemote).toBe(false);
  });

  it('honors a newer delete tombstone', () => {
    const local: SyncSnapshot = { a: { value: 'x', updatedAt: 30, deleted: true } };
    const remote: SyncSnapshot = { a: { value: 'x', updatedAt: 20 } };
    const { merged } = mergeSnapshots(local, remote);
    expect(merged.a.deleted).toBe(true);
  });

  it('flags changedFromRemote when the merge introduces a local-only key', () => {
    const { changedFromRemote } = mergeSnapshots({ a: { value: 1, updatedAt: 5 } }, {});
    expect(changedFromRemote).toBe(true);
  });
});

describe('pruneTombstones', () => {
  it('drops deleted entries and keeps live ones', () => {
    const snap: SyncSnapshot = {
      a: { value: 1, updatedAt: 1 },
      b: { value: 2, updatedAt: 2, deleted: true },
    };
    expect(pruneTombstones(snap)).toEqual({ a: { value: 1, updatedAt: 1 } });
  });
});

function memoryTransport(initial: SyncSnapshot): SyncTransport & { store: SyncSnapshot } {
  const state = { store: { ...initial } };
  return {
    store: state.store,
    pull: vi.fn(async () => state.store),
    push: vi.fn(async (snapshot: SyncSnapshot) => {
      state.store = snapshot;
    }),
  } as unknown as SyncTransport & { store: SyncSnapshot };
}

describe('syncOnce', () => {
  it('pulls, merges, and pushes when the local side has new data', async () => {
    const transport = memoryTransport({ a: { value: 'remote', updatedAt: 1 } });
    const local: SyncSnapshot = { b: { value: 'local', updatedAt: 2 } };
    const outcome = await syncOnce(local, transport);
    expect(outcome.pushed).toBe(true);
    expect(outcome.merged).toEqual({
      a: { value: 'remote', updatedAt: 1 },
      b: { value: 'local', updatedAt: 2 },
    });
    expect(transport.push).toHaveBeenCalledTimes(1);
  });

  it('does not push when local already matches remote', async () => {
    const same: SyncSnapshot = { a: { value: 1, updatedAt: 1 } };
    const transport = memoryTransport(same);
    const outcome = await syncOnce({ a: { value: 1, updatedAt: 1 } }, transport);
    expect(outcome.pushed).toBe(false);
    expect(transport.push).not.toHaveBeenCalled();
  });

  it('reports conflicts from the merge', async () => {
    const transport = memoryTransport({ a: { value: 'remote', updatedAt: 20 } });
    const outcome = await syncOnce({ a: { value: 'local', updatedAt: 10 } }, transport);
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]?.winner).toBe('remote');
  });

  it('propagates transport errors so the caller can show an offline state', async () => {
    const failing: SyncTransport = {
      pull: vi.fn(async () => {
        throw new Error('network');
      }),
      push: vi.fn(),
    };
    await expect(syncOnce({}, failing)).rejects.toThrow('network');
  });
});
