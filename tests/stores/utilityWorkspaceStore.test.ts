import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  migrateLegacyUtilityWorkspaceEnvelope,
  UTILITY_WORKSPACE_STORAGE_KEY,
  useUtilityWorkspaceStore,
} from '@/stores/utilityWorkspaceStore';

const LEGACY_STORAGE_KEY = 'lingua-utility-state';

beforeEach(() => {
  useUtilityWorkspaceStore.setState(
    { activeUtilityId: 'json', pendingUtilityInput: null },
    false
  );
  // setState flows through persist and writes the default selection, so clear
  // both keys afterward to model a genuinely fresh or legacy-only launch.
  localStorage.removeItem(UTILITY_WORKSPACE_STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(UTILITY_WORKSPACE_STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
});

describe('utilityWorkspaceStore — selection', () => {
  it('tracks and persists the active utility', async () => {
    useUtilityWorkspaceStore.getState().setActiveUtilityId('jwt');
    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('jwt');

    await Promise.resolve();
    const raw = localStorage.getItem(UTILITY_WORKSPACE_STORAGE_KEY);
    expect(raw).toContain('jwt');
  });

  it('rejects an unknown utility id', () => {
    useUtilityWorkspaceStore.getState().setActiveUtilityId('missing' as never);
    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('json');
  });
});

describe('utilityWorkspaceStore — pending Smart Paste input', () => {
  it('sets and clears the one-shot seed without persisting its contents', async () => {
    useUtilityWorkspaceStore
      .getState()
      .setPendingUtilityInput({ utilityId: 'jwt', input: 'secret-token' });
    expect(useUtilityWorkspaceStore.getState().pendingUtilityInput).toEqual({
      utilityId: 'jwt',
      input: 'secret-token',
    });

    await Promise.resolve();
    const raw = localStorage.getItem(UTILITY_WORKSPACE_STORAGE_KEY);
    expect(raw).not.toContain('pendingUtilityInput');
    expect(raw).not.toContain('secret-token');

    useUtilityWorkspaceStore.getState().setPendingUtilityInput(null);
    expect(useUtilityWorkspaceStore.getState().pendingUtilityInput).toBeNull();
  });

  it('rejects a seed addressed to an unknown utility', () => {
    useUtilityWorkspaceStore
      .getState()
      .setPendingUtilityInput({ utilityId: 'missing' as never, input: 'x' });
    expect(useUtilityWorkspaceStore.getState().pendingUtilityInput).toBeNull();
  });
});

describe('legacy selection migration', () => {
  it('extracts a valid active utility from the history-store envelope', () => {
    expect(
      migrateLegacyUtilityWorkspaceEnvelope(
        JSON.stringify({ state: { activeUtilityId: 'timestamp', history: {} }, version: 1 })
      )
    ).toBe(JSON.stringify({ state: { activeUtilityId: 'timestamp' }, version: 1 }));
  });

  it('ignores corrupt and unknown legacy selections', () => {
    expect(migrateLegacyUtilityWorkspaceEnvelope('{broken')).toBeNull();
    expect(
      migrateLegacyUtilityWorkspaceEnvelope(
        JSON.stringify({ state: { activeUtilityId: 'removed-tool' }, version: 1 })
      )
    ).toBeNull();
  });

  it('rehydrates from the legacy key once and writes the dedicated envelope', async () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ state: { activeUtilityId: 'base64', favorites: [] }, version: 1 })
    );

    await useUtilityWorkspaceStore.persist.rehydrate();

    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('base64');
    expect(localStorage.getItem(UTILITY_WORKSPACE_STORAGE_KEY)).toContain('base64');
  });
});
