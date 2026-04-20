/**
 * RL-011 Slice B — store plumbing tests. Pins the tier model, the
 * accept/reject contract on writes, the clear-scope semantics, the
 * `localStorage` rehydrate sanitization, and the `resolveEffectiveEnv`
 * helper's composition with the Slice A merger.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEnvVarsStore } from '@/stores/envVarsStore';

const initial = useEnvVarsStore.getState();

beforeEach(() => {
  useEnvVarsStore.setState(initial, true);
  // The persist middleware uses localStorage under the hood; clear the
  // mirror between tests so rehydrate tests start clean.
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('lingua-env-vars');
  }
});

afterEach(() => {
  useEnvVarsStore.setState(initial, true);
});

describe('envVarsStore — per-tier writes', () => {
  it('accepts a canonical key/value on every tier', () => {
    const store = useEnvVarsStore.getState();
    expect(store.setGlobalVar('FOO', 'g')).toBe(true);
    expect(store.setProjectVar('p1', 'BAR', 'j')).toBe(true);
    expect(store.setTabVar('t1', 'BAZ', 't')).toBe(true);

    const next = useEnvVarsStore.getState();
    expect(next.global.FOO).toBe('g');
    expect(next.project.p1?.BAR).toBe('j');
    expect(next.tab.t1?.BAZ).toBe('t');
  });

  it('rejects reserved / invalid keys at every tier without mutating state', () => {
    const store = useEnvVarsStore.getState();
    expect(store.setGlobalVar('PATH', 'hostile')).toBe(false);
    expect(store.setGlobalVar('1BAD', 'x')).toBe(false);
    expect(store.setProjectVar('p1', 'WITH SPACE', 'x')).toBe(false);
    expect(store.setTabVar('t1', 'HOME', 'x')).toBe(false);

    const next = useEnvVarsStore.getState();
    expect(next.global).toEqual({});
    expect(next.project).toEqual({});
    expect(next.tab).toEqual({});
  });

  it('rejects writes when the projectId or tabId is empty', () => {
    const store = useEnvVarsStore.getState();
    expect(store.setProjectVar('', 'FOO', 'ok')).toBe(false);
    expect(store.setTabVar('', 'FOO', 'ok')).toBe(false);
    expect(useEnvVarsStore.getState().project).toEqual({});
    expect(useEnvVarsStore.getState().tab).toEqual({});
  });

  it('enforces the 32k per-value cap even when the key is valid', () => {
    const store = useEnvVarsStore.getState();
    const big = 'a'.repeat(40_000);
    expect(store.setGlobalVar('HUGE', big)).toBe(false);
    expect(useEnvVarsStore.getState().global).toEqual({});
  });
});

describe('envVarsStore — removal + clearScope', () => {
  it('removeGlobalVar drops only the targeted key', () => {
    const store = useEnvVarsStore.getState();
    store.setGlobalVar('A', '1');
    store.setGlobalVar('B', '2');
    store.removeGlobalVar('A');
    expect(useEnvVarsStore.getState().global).toEqual({ B: '2' });
  });

  it('removeProjectVar prunes the projectId entry once the scope is empty', () => {
    const store = useEnvVarsStore.getState();
    store.setProjectVar('p1', 'A', '1');
    store.removeProjectVar('p1', 'A');
    expect('p1' in useEnvVarsStore.getState().project).toBe(false);
  });

  it('removeTabVar keeps the tabId entry when other keys remain', () => {
    const store = useEnvVarsStore.getState();
    store.setTabVar('t1', 'A', '1');
    store.setTabVar('t1', 'B', '2');
    store.removeTabVar('t1', 'A');
    expect(useEnvVarsStore.getState().tab.t1).toEqual({ B: '2' });
  });

  it('clearScope clears a single tier or a single scopeKey within a tier', () => {
    const store = useEnvVarsStore.getState();
    store.setGlobalVar('A', '1');
    store.setProjectVar('p1', 'A', '1');
    store.setProjectVar('p2', 'A', '1');
    store.setTabVar('t1', 'A', '1');

    store.clearScope('project', 'p1');
    expect('p1' in useEnvVarsStore.getState().project).toBe(false);
    expect(useEnvVarsStore.getState().project.p2).toBeDefined();

    store.clearScope('tab');
    expect(useEnvVarsStore.getState().tab).toEqual({});

    store.clearScope('global');
    expect(useEnvVarsStore.getState().global).toEqual({});
  });
});

describe('envVarsStore — resolveEffectiveEnv', () => {
  it('returns the Slice A merge with tab > project > global > processEnv', () => {
    const store = useEnvVarsStore.getState();
    store.setGlobalVar('LEVEL', 'global');
    store.setGlobalVar('ONLY_G', 'g');
    store.setProjectVar('p1', 'LEVEL', 'project');
    store.setTabVar('t1', 'LEVEL', 'tab');

    const merged = store.resolveEffectiveEnv(
      { LEVEL: 'process', ONLY_P: 'p' },
      'p1',
      't1'
    );
    expect(merged.LEVEL).toBe('tab');
    expect(merged.ONLY_G).toBe('g');
    expect(merged.ONLY_P).toBe('p');
  });

  it('skips the project tier when projectId is null and skips tab when tabId is null', () => {
    const store = useEnvVarsStore.getState();
    store.setGlobalVar('FOO', 'g');
    store.setProjectVar('p1', 'FOO', 'j');
    store.setTabVar('t1', 'FOO', 't');

    expect(store.resolveEffectiveEnv({}, null, null).FOO).toBe('g');
    expect(store.resolveEffectiveEnv({}, 'p1', null).FOO).toBe('j');
    expect(store.resolveEffectiveEnv({}, 'p1', 't1').FOO).toBe('t');
  });

  it('returns a frozen record (matches the Slice A mergeEnvScopes contract)', () => {
    const store = useEnvVarsStore.getState();
    store.setGlobalVar('A', '1');
    const merged = store.resolveEffectiveEnv({}, null, null);
    expect(Object.isFrozen(merged)).toBe(true);
  });
});

describe('envVarsStore — persistence sanitization', () => {
  it('drops hostile keys and non-string values on rehydrate', () => {
    // Simulate a tampered persisted payload. The `persist` middleware
    // reads from `localStorage` on initialization; rewriting here and
    // calling `rehydrate()` forces the merge path.
    localStorage.setItem(
      'lingua-env-vars',
      JSON.stringify({
        state: {
          global: { FOO: 'keep', PATH: 'hostile', '1BAD': 'x' },
          project: {
            p1: { OK: 'ok', 'WITH SPACE': 'no' },
            '': { LEAKED: 'no' },
          },
          tab: { t1: { OK: 'ok', HOME: 'no' } },
        },
        version: 0,
      })
    );

    void useEnvVarsStore.persist.rehydrate();

    const state = useEnvVarsStore.getState();
    expect(state.global).toEqual({ FOO: 'keep' });
    expect(state.project.p1).toEqual({ OK: 'ok' });
    expect('' in state.project).toBe(false);
    expect(state.tab.t1).toEqual({ OK: 'ok' });
  });
});
