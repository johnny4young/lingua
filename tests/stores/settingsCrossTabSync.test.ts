import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSettingsState } from '@/stores/settingsDefaults';
import { useSettingsStore } from '@/stores/settingsStore';

const KEY = 'lingua-settings';
const VERSION = useSettingsStore.persist.getOptions().version as number;

// jsdom shares one window, so another tab's change is its write plus the event.
function otherTabWrites(state: Record<string, unknown>, version = VERSION): void {
  const stored = JSON.parse(localStorage.getItem(KEY) ?? '{"state":{}}') as {
    state: Record<string, unknown>;
  };
  localStorage.setItem(KEY, JSON.stringify({ state: { ...stored.state, ...state }, version }));
  window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
}

function storedSettings(): { state: Record<string, unknown>; version: number } {
  return JSON.parse(localStorage.getItem(KEY) as string);
}

describe('settings cross-tab sync', () => {
  const initialState = useSettingsStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState(initialState, true);
    useSettingsStore.setState({
      telemetryConsent: 'granted',
      utilitiesClipboardOnFocusConsent: 'granted',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies a revocation from another tab', () => {
    otherTabWrites({ telemetryConsent: 'declined', utilitiesClipboardOnFocusConsent: 'declined' });

    const state = useSettingsStore.getState();
    expect(state.telemetryConsent).toBe('declined');
    expect(state.utilitiesClipboardOnFocusConsent).toBe('declined');
  });

  it('keeps the revocation through a later write in this tab', () => {
    otherTabWrites({ telemetryConsent: 'declined' });

    useSettingsStore.getState().toggleWordWrap();

    expect(storedSettings().state.telemetryConsent).toBe('declined');
  });

  it('does not write back when it applies a change', () => {
    otherTabWrites({ telemetryConsent: 'declined' });
    const setItem = vi.spyOn(localStorage, 'setItem');

    otherTabWrites({ telemetryConsent: 'granted' });

    // The only write is the simulated tab's own.
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('keeps fields that are not persisted', () => {
    const { toggleWordWrap } = useSettingsStore.getState();

    otherTabWrites({ telemetryConsent: 'declined' });

    expect(useSettingsStore.getState().toggleWordWrap).toBe(toggleWordWrap);
  });

  it.each([
    ['newer', VERSION + 1],
    ['older', VERSION - 1],
  ])('ignores a write from a %s schema without writing back', (_label, version) => {
    otherTabWrites({ telemetryConsent: 'declined' }, version);

    expect(useSettingsStore.getState().telemetryConsent).toBe('granted');
    // Rewriting the version here is what would make two bundles trade writes forever.
    expect(storedSettings().version).toBe(version);
  });

  it('resets to defaults without writing when the key is removed', () => {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    const defaults = createInitialSettingsState();
    expect(useSettingsStore.getState().telemetryConsent).toBe(defaults.telemetryConsent);
    expect(useSettingsStore.getState().utilitiesClipboardOnFocusConsent).toBe(
      defaults.utilitiesClipboardOnFocusConsent
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reads the current value when an event describes a write already replaced', () => {
    // Clear store row: defaults are written, then the key is removed.
    localStorage.removeItem(KEY);
    window.dispatchEvent(
      new StorageEvent('storage', { key: KEY, newValue: '{"state":{},"version":4}' })
    );

    expect(useSettingsStore.getState().telemetryConsent).toBe(
      createInitialSettingsState().telemetryConsent
    );
  });

  it('resets to defaults when another tab clears all storage', () => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(useSettingsStore.getState().telemetryConsent).toBe(
      createInitialSettingsState().telemetryConsent
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores other keys', () => {
    const rehydrate = vi.spyOn(useSettingsStore.persist, 'rehydrate');

    window.dispatchEvent(new StorageEvent('storage', { key: 'lingua-snippets' }));

    expect(rehydrate).not.toHaveBeenCalled();
  });

  it('ignores a value it cannot parse', () => {
    localStorage.setItem(KEY, '{not json');
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    expect(useSettingsStore.getState().telemetryConsent).toBe('granted');
  });

  it('catches up when the page returns from the back/forward cache', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { telemetryConsent: 'declined' }, version: VERSION })
    );

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    expect(useSettingsStore.getState().telemetryConsent).toBe('granted');

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(useSettingsStore.getState().telemetryConsent).toBe('declined');
  });
});
