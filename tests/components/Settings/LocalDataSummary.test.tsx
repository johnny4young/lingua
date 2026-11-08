import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyTrustSection } from '@/components/Settings/PrivacyTrustSection';
import { formatBytes, getLocalStoreRows } from '@/components/Settings/privacyTrustHelpers';
import {
  useExecutionHistoryStore,
  type ExecutionHistoryEntry,
} from '@/stores/executionHistoryStore';
import { useImportedCapsuleStore } from '@/stores/importedCapsuleStore';
import { useUIStore } from '@/stores/uiStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { useUtilityHistoryStore } from '@/stores/utilityHistoryStore';
import { useWorkspaceSqlStore } from '@/stores/workspaceSqlStore';
import { createBlankSqlQuery } from '@/../shared/sqlWorkspace';
import type { RunCapsuleV1 } from '@/../shared/runCapsule';

const { sqlBytesMock, clearSqlMock } = vi.hoisted(() => ({
  sqlBytesMock: vi.fn(),
  clearSqlMock: vi.fn(),
}));

vi.mock('@/runtime/duckdbClient', () => ({
  persistedSqlDatabaseBytes: () => sqlBytesMock(),
  clearPersistedSqlDatabase: () => clearSqlMock(),
}));
vi.mock('@/utils/telemetry', () => ({ trackEvent: vi.fn() }));

const initialUIState = useUIStore.getState();
const originalLingua = (window as { lingua?: unknown }).lingua;

const capsuleEntry = (id: string) =>
  ({
    id,
    lastCapsule: { id: `capsule-${id}` } as unknown as RunCapsuleV1,
  }) as ExecutionHistoryEntry;

function setPlatform(platform: string, revealFolder = vi.fn().mockResolvedValue({ ok: true })) {
  Object.defineProperty(window, 'lingua', {
    configurable: true,
    value: { platform, recovery: { revealFolder } },
  });
  return revealFolder;
}

describe('Local data summary', () => {
  const pushStatusNoticeMock = vi.fn();

  beforeEach(async () => {
    await i18next.changeLanguage('en');
    window.localStorage.clear();
    sqlBytesMock.mockReset().mockResolvedValue(2048);
    clearSqlMock.mockReset().mockResolvedValue(undefined);
    useExecutionHistoryStore.setState({ entries: [capsuleEntry('a'), capsuleEntry('b')] });
    useImportedCapsuleStore.setState({ entries: [{ id: 'imported-c', capsule: { capsuleId: 'c' } as unknown as RunCapsuleV1, importedAt: 1 }] });
    useUIStore.setState(initialUIState, true);
    useUIStore.setState({ pushStatusNotice: pushStatusNoticeMock });
    pushStatusNoticeMock.mockReset();
    setPlatform('web');
  });

  afterEach(() => {
    cleanup();
    useExecutionHistoryStore.setState({ entries: [] });
    Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
  });

  it('totals the stores and the SQL database and counts the capsules', async () => {
    window.localStorage.setItem('lingua-snippets', 'abcdef');
    render(<PrivacyTrustSection />);

    const storesBytes = getLocalStoreRows().reduce((sum, row) => sum + row.bytes, 0);
    const total = screen.getByTestId('privacy-local-data-total');
    await waitFor(() => expect(total.textContent).toContain(formatBytes(storesBytes + 2048)));
    expect(total.textContent).toContain(`SQL database ${formatBytes(2048)}`);
    expect(total.textContent).toContain(`6 stores ${formatBytes(storesBytes)}`);
    expect(screen.getByTestId('privacy-capsules-retained').textContent).toBe(
      '3 capsules in memory (cleared on reload)'
    );
  });

  it('counts and clears runs kept for Compare runs even after their capsules are gone', async () => {
    sqlBytesMock.mockResolvedValue(0);
    useImportedCapsuleStore.setState({ entries: [] });
    useExecutionHistoryStore.setState({
      entries: [{ id: 'kept', runCompare: { code: 'secret', stdout: 'out' } } as unknown as ExecutionHistoryEntry],
    });
    render(<PrivacyTrustSection />);
    await waitFor(() => expect(sqlBytesMock).toHaveBeenCalled());
    expect(screen.getByTestId('privacy-local-data-total').textContent).toContain('1 run kept for Compare runs');

    const clearAll = screen.getByTestId('privacy-local-data-clear-all') as HTMLButtonElement;
    await waitFor(() => expect(clearAll.disabled).toBe(false));
    fireEvent.click(clearAll);
    expect(within(screen.getByTestId('privacy-clear-all-items')).getByText('Code and output of 1 run kept for Compare runs')).toBeTruthy();
    fireEvent.click(screen.getByTestId('privacy-clear-all-confirm'));
    await waitFor(() => expect(useExecutionHistoryStore.getState().entries[0]?.runCompare).toBeUndefined());
  });

  it('says the SQL database is open when its size cannot be read', async () => {
    sqlBytesMock.mockResolvedValue(null);
    render(<PrivacyTrustSection />);
    await waitFor(() =>
      expect(screen.getByTestId('privacy-local-data-total').textContent).toContain(
        'SQL database open in the SQL workspace'
      )
    );
  });

  it('clears every store, the SQL database and the capsules behind one confirm', async () => {
    window.localStorage.setItem('lingua-snippets', 'abcdef');
    window.localStorage.setItem('lingua-utility-state', '{}');
    render(<PrivacyTrustSection />);
    await waitFor(() => expect(sqlBytesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('privacy-local-data-clear-all'));
    const items = within(screen.getByTestId('privacy-clear-all-items'));
    expect(items.getByText(/lingua-snippets, lingua-utility-state/)).toBeTruthy();
    expect(items.getByText(/SQL workspace database/)).toBeTruthy();
    expect(items.getByText('3 run capsules held in memory')).toBeTruthy();
    expect(screen.getByText(/HTTP requests and environments, notebooks/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('privacy-clear-all-confirm'));
    await waitFor(() => expect(screen.queryByTestId('privacy-clear-all-modal')).toBeNull());

    expect(window.localStorage.getItem('lingua-snippets')).toBeNull();
    expect(window.localStorage.getItem('lingua-utility-state')).toBeNull();
    expect(clearSqlMock).toHaveBeenCalledTimes(1);
    expect(useExecutionHistoryStore.getState().capsuleEntries()).toHaveLength(0);
    expect(useImportedCapsuleStore.getState().entries).toHaveLength(0);
    expect(pushStatusNoticeMock).toHaveBeenCalledTimes(1);
    expect(pushStatusNoticeMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'settings.privacy.localData.cleared' })
    );
  });

  it('resets the live stores, so a later change does not write the cleared data back', async () => {
    useSnippetsStore.setState({
      snippets: [
        {
          id: 's1',
          label: 'secret',
          description: '',
          code: 'token',
          language: 'javascript',
          createdAt: 1,
        },
      ],
    });
    useUtilityHistoryStore.setState({ favorites: ['jwt'] });
    render(<PrivacyTrustSection />);
    await waitFor(() => expect(sqlBytesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('privacy-local-data-clear-all'));
    fireEvent.click(screen.getByTestId('privacy-clear-all-confirm'));
    await waitFor(() => expect(screen.queryByTestId('privacy-clear-all-modal')).toBeNull());

    expect(useSnippetsStore.getState().snippets).toEqual([]);
    expect(useUtilityHistoryStore.getState().favorites).toEqual([]);
    useUtilityHistoryStore.setState({ history: {} });
    useSnippetsStore.setState({ snippets: [] });
    expect(window.localStorage.getItem('lingua-snippets') ?? '').not.toContain('secret');
    expect(window.localStorage.getItem('lingua-utility-state') ?? '').not.toContain('jwt');
  });

  it('clears the SQL queries and the run History with the rest', async () => {
    useWorkspaceSqlStore.getState().createQuery(createBlankSqlQuery({ id: 'q1', query: 'SELECT secret_column' }));
    useWorkspaceSqlStore.getState().recordHistory({
      version: 1,
      id: 'h1',
      sql: 'SELECT secret_column',
      status: 'success',
      durationMs: 1,
      rowCount: 1,
      recordedAt: '2026-10-21T00:00:00.000Z',
    });
    render(<PrivacyTrustSection />);
    await waitFor(() => expect(sqlBytesMock).toHaveBeenCalled());
    expect(screen.getByTestId('privacy-local-stores-row-lingua-workspace-sql-state')).toBeTruthy();

    fireEvent.click(screen.getByTestId('privacy-local-data-clear-all'));
    expect(screen.getByTestId('privacy-clear-all-items').textContent).toContain('lingua-workspace-sql-state');
    fireEvent.click(screen.getByTestId('privacy-clear-all-confirm'));
    await waitFor(() => expect(screen.queryByTestId('privacy-clear-all-modal')).toBeNull());

    expect(useWorkspaceSqlStore.getState().queries).toEqual([]);
    expect(useWorkspaceSqlStore.getState().history).toEqual([]);
    expect(window.localStorage.getItem('lingua-workspace-sql-state') ?? '').not.toContain('secret_column');
  });

  it('waits for the SQL size before offering Clear everything', async () => {
    let resolveSize: (bytes: number) => void = () => undefined;
    sqlBytesMock.mockReturnValue(new Promise<number>(resolve => (resolveSize = resolve)));
    window.localStorage.setItem('lingua-snippets', 'abcdef');
    render(<PrivacyTrustSection />);
    expect(screen.getByTestId('privacy-local-data-clear-all').hasAttribute('disabled')).toBe(true);
    resolveSize(1024);
    await waitFor(() =>
      expect(screen.getByTestId('privacy-local-data-clear-all').hasAttribute('disabled')).toBe(
        false
      )
    );
  });

  it('says so when the SQL database cannot be cleared', async () => {
    clearSqlMock.mockRejectedValue(new Error('locked'));
    render(<PrivacyTrustSection />);
    await waitFor(() => expect(sqlBytesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('privacy-local-data-clear-all'));
    fireEvent.click(screen.getByTestId('privacy-clear-all-confirm'));
    await waitFor(() =>
      expect(pushStatusNoticeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          messageKey: 'settings.privacy.localData.clearFailed',
        })
      )
    );
    expect(pushStatusNoticeMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'settings.privacy.localData.cleared' })
    );
    // The rest of the batch still runs.
    expect(useExecutionHistoryStore.getState().capsuleEntries()).toHaveLength(0);
  });

  it('warns that clearing the license turns Pro off, and keeps everything on cancel', async () => {
    window.localStorage.setItem('lingua-license', 'token');
    render(<PrivacyTrustSection />);
    await waitFor(() => expect(sqlBytesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('privacy-local-data-clear-all'));
    expect(screen.getByText(/Pro features turn off/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('privacy-clear-all-cancel'));

    expect(window.localStorage.getItem('lingua-license')).toBe('token');
    expect(clearSqlMock).not.toHaveBeenCalled();
    expect(useExecutionHistoryStore.getState().capsuleEntries()).toHaveLength(2);
  });

  it('reveals the app data folder on desktop only', async () => {
    render(<PrivacyTrustSection />);
    expect(screen.queryByTestId('privacy-local-data-reveal')).toBeNull();
    cleanup();

    const revealFolder = setPlatform('darwin');
    render(<PrivacyTrustSection />);
    fireEvent.click(screen.getByTestId('privacy-local-data-reveal'));
    await waitFor(() => expect(revealFolder).toHaveBeenCalledTimes(1));
  });
});
