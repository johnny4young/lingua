import { beforeEach, describe, expect, it } from 'vitest';
import { useImportedCapsuleStore } from '../../src/renderer/stores/importedCapsuleStore';
import { CAPSULE_LRU_CAP_PRO } from '../../src/renderer/stores/executionHistoryStore';
import { FIXTURE_FULL_TS, FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

const ids = () => useImportedCapsuleStore.getState().entries.map((entry) => entry.capsule.capsuleId);

describe('imported capsule store', () => {
  beforeEach(() => useImportedCapsuleStore.setState({ entries: [] }));

  it('moves a re-imported capsule to the newest slot instead of listing it twice', () => {
    const { add } = useImportedCapsuleStore.getState();
    add(FIXTURE_MINIMAL_JS);
    add(FIXTURE_FULL_TS);
    add(FIXTURE_MINIMAL_JS);
    expect(ids()).toEqual([FIXTURE_FULL_TS.capsuleId, FIXTURE_MINIMAL_JS.capsuleId]);
  });

  it('keeps the newest imports within the shared cap', () => {
    for (let index = 0; index <= CAPSULE_LRU_CAP_PRO; index += 1) {
      useImportedCapsuleStore.getState().add({ ...FIXTURE_MINIMAL_JS, capsuleId: `capsule-${index}` });
    }
    expect(ids()).toHaveLength(CAPSULE_LRU_CAP_PRO);
    expect(ids()[0]).toBe('capsule-1');
  });

  it('restores a removed import at its old position, once', () => {
    const store = useImportedCapsuleStore.getState();
    store.add(FIXTURE_MINIMAL_JS);
    store.add(FIXTURE_FULL_TS);
    const removed = useImportedCapsuleStore.getState().entries[0]!;
    store.remove(removed.id);
    store.restore(removed, 0);
    store.restore(removed, 0);
    expect(ids()).toEqual([FIXTURE_MINIMAL_JS.capsuleId, FIXTURE_FULL_TS.capsuleId]);
  });
});
