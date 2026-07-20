/**
 * implementation note — Settings → Editor → SQL workspace subsection.
 *
 * Verifies the row-display-limit + query-timeout selects render, reflect
 * the persisted settings, and route changes to the (clamped) store
 * actions. Spanish spot-check pins the tuteo copy.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EditorSection } from '@/components/Settings/EditorSection';
import { useSettingsStore } from '@/stores/settingsStore';

describe('EditorSection — SQL workspace subsection ', () => {
  const initialSettings = useSettingsStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialSettings, true);
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initialSettings, true);
  });

  it('renders both SQL workspace controls reflecting the persisted settings', () => {
    useSettingsStore.setState({
      sqlWorkspaceRowDisplayLimit: 500,
      sqlWorkspaceQueryTimeoutMs: 15_000,
    });
    render(<EditorSection />);

    const rowLimit = screen.getByTestId(
      'settings-sql-row-display-limit'
    ) as HTMLSelectElement;
    const timeout = screen.getByTestId(
      'settings-sql-query-timeout'
    ) as HTMLSelectElement;

    expect(rowLimit.value).toBe('500');
    expect(timeout.value).toBe('15000');
  });

  it('changing the row-limit select calls setSqlWorkspaceRowDisplayLimit', () => {
    render(<EditorSection />);

    fireEvent.change(screen.getByTestId('settings-sql-row-display-limit'), {
      target: { value: '5000' },
    });

    expect(useSettingsStore.getState().sqlWorkspaceRowDisplayLimit).toBe(5000);
  });

  it('changing the query-timeout select calls setSqlWorkspaceQueryTimeoutMs', () => {
    render(<EditorSection />);

    fireEvent.change(screen.getByTestId('settings-sql-query-timeout'), {
      target: { value: '60000' },
    });

    expect(useSettingsStore.getState().sqlWorkspaceQueryTimeoutMs).toBe(60_000);
  });

  it('renders the persist-tables toggle and flips the setting on click (implementation OPFS)', () => {
    useSettingsStore.setState({ sqlWorkspacePersistTables: false });
    render(<EditorSection />);

    const toggle = screen.getByLabelText('Persist tables across sessions');
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().sqlWorkspacePersistTables).toBe(true);

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().sqlWorkspacePersistTables).toBe(false);
  });

  it('renders the clear + reconnect actions (implementation OPFS)', () => {
    render(<EditorSection />);
    // Present but not clicked here — both touch the live DuckDB engine
    // (reconnect re-instantiates; clear terminates), exercised in the
    // web smoke, not this isolated render.
    expect(screen.getByTestId('settings-sql-reconnect')).toBeTruthy();
    expect(screen.getByTestId('settings-sql-clear-data')).toBeTruthy();
  });

  it('localizes the subsection in Spanish (tuteo)', async () => {
    await i18next.changeLanguage('es');
    render(<EditorSection />);

    expect(screen.getByText('Límite de filas mostradas')).toBeTruthy();
    expect(
      screen.getByText('Tiempo de espera de la consulta')
    ).toBeTruthy();
    // implementation — tuteo imperative for the persistence toggle.
    expect(
      screen.getByText('Conserva las tablas entre sesiones')
    ).toBeTruthy();
  });
});
