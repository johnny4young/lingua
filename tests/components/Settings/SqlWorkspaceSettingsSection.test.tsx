import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { SqlWorkspaceSettingsSection } from '@/components/Settings/SqlWorkspaceSettingsSection';
import type { ResolvedLocalEngine } from '@/runtime/duckdbClient';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';

const engine = vi.hoisted(() => {
  let resolved: unknown = null;
  const listeners = new Set<() => void>();
  return {
    get: () => resolved,
    set(next: unknown) {
      resolved = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: vi.fn(),
  };
});

vi.mock('@/runtime/duckdbClient', async importOriginal => ({
  ...(await importOriginal<typeof import('@/runtime/duckdbClient')>()),
  getResolvedLocalEngine: () => engine.get(),
  subscribeResolvedLocalEngine: (listener: () => void) => engine.subscribe(listener),
  clearPersistedSqlDatabase: () => engine.clear(),
}));

const originalLingua = (window as { lingua?: unknown }).lingua;
const initialSettings = useSettingsStore.getState();
const initialUI = useUIStore.getState();

function desktop(available: boolean) {
  Object.defineProperty(window, 'lingua', { configurable: true, value: { sqlLocal: { status: async () => ({ available }) } } });
}

describe('SQL workspace settings with the native engine', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    engine.set(null);
    engine.clear.mockReset().mockResolvedValue(undefined);
    useSettingsStore.setState({ sqlWorkspaceLocalEngine: 'native' });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initialSettings, true);
    useUIStore.setState(initialUI, true);
    Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
    vi.unstubAllGlobals();
  });

  it('hides the engine row on web, which has no native engine to offer', async () => {
    Object.defineProperty(window, 'lingua', { configurable: true, value: {} });
    render(<SqlWorkspaceSettingsSection />);
    await Promise.resolve();
    expect(screen.queryByTestId('settings-sql-local-engine')).toBeNull();
    expect(screen.queryByText('The native engine is not available, so Local SQL runs on WebAssembly.')).toBeNull();
  });

  it('shows a stored native choice that this build cannot run as WebAssembly, with the browser storage hint', async () => {
    desktop(false);
    render(<SqlWorkspaceSettingsSection />);
    expect(await screen.findByText('The native engine is not available, so Local SQL runs on WebAssembly.')).toBeTruthy();
    expect((screen.getByTestId('settings-sql-local-engine') as HTMLSelectElement).value).toBe('wasm');
    expect(screen.queryByText(/in Lingua's data folder/)).toBeNull();
  });

  it('follows the engine that resolved: the fallback note and the storage hint update live', async () => {
    desktop(true);
    render(<SqlWorkspaceSettingsSection />);
    expect(await screen.findByText(/in Lingua's data folder/)).toBeTruthy();
    act(() => engine.set({ engine: 'wasm', fallback: 'failed', reason: 'boom' } satisfies ResolvedLocalEngine));
    expect(screen.getByText('The native engine is not available, so Local SQL runs on WebAssembly.')).toBeTruthy();
    expect(screen.queryByText(/in Lingua's data folder/)).toBeNull();
  });

  it('reports a clear that failed instead of a success', async () => {
    desktop(true);
    vi.stubGlobal('confirm', () => true);
    const pushStatusNotice = vi.fn();
    useUIStore.setState({ pushStatusNotice });
    engine.clear.mockRejectedValue(new Error('The SQL database is in use.'));
    render(<SqlWorkspaceSettingsSection />);
    fireEvent.click(screen.getByTestId('settings-sql-clear-data'));
    await waitFor(() =>
      expect(pushStatusNotice).toHaveBeenCalledWith({
        tone: 'warning',
        messageKey: 'settings.editor.sqlWorkspace.persistTables.clearFailed',
        detail: 'The SQL database is in use.',
      })
    );
    expect(pushStatusNotice).toHaveBeenCalledTimes(1);
  });

  it('localizes the new notes in Spanish (tuteo)', async () => {
    await i18next.changeLanguage('es');
    desktop(false);
    render(<SqlWorkspaceSettingsSection />);
    expect(await screen.findByText('El motor nativo no está disponible, así que SQL local usa WebAssembly.')).toBeTruthy();
    expect(i18next.t('settings.editor.sqlWorkspace.persistTables.clearFailed')).toMatch(/^No se pudieron borrar/);
  });
});
