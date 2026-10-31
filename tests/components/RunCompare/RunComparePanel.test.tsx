import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n';
import { RunComparePanel } from '@/components/RunCompare/RunComparePanel';
import { type ExecutionHistoryEntry, useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useEditorStore } from '@/stores/editorStore';
import type { RunCompareRecord } from '@/utils/runCompareRecord';

function runCompare(overrides: Partial<RunCompareRecord>): RunCompareRecord {
  return {
    name: 'Sorting.js', language: 'javascript', runtime: 'worker', code: '', stdout: '', stderr: '',
    truncated: false, values: [], exit: 'success', ...overrides,
  };
}

const today = new Date();
const at = (hour: number, minute: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute).getTime();

const entries: ExecutionHistoryEntry[] = [
  {
    id: 'old', language: 'sql', status: 'ok', durationMs: 13, timestamp: at(0, 5), snapshot: null,
    runCompare: runCompare({ name: 'Untitled query', language: 'sql', runtime: 'duckdb-wasm', summary: { kind: 'rows', count: 3, columns: ['city', 'orders'] } }),
  },
  {
    id: 'first', language: 'javascript', status: 'ok', durationMs: 2.5, timestamp: at(0, 29), snapshot: null, tabId: 'tab-1',
    runCompare: runCompare({ code: 'const mid = [pivot];', stdout: 'QuickSort: [ 1, 2, 3 ]', values: [{ line: 11, value: 'length 6' }] }),
  },
  { id: 'bare', language: 'javascript', status: 'error', durationMs: null, timestamp: at(0, 31), snapshot: null, tabId: 'tab-1' },
  {
    id: 'second', language: 'javascript', status: 'ok', durationMs: 18900, timestamp: at(0, 42), snapshot: null, tabId: 'tab-1',
    runCompare: runCompare({ code: 'const mid = arr.filter((x) => x === pivot);', stdout: 'QuickSort: [ 1, 1, 2, 3 ]', values: [{ line: 11, value: 'length 7' }] }),
  },
];

const initialHistory = useExecutionHistoryStore.getState();

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useExecutionHistoryStore.setState({ entries });
});

afterEach(() => {
  useExecutionHistoryStore.setState(initialHistory, true);
});

describe('run compare panel', () => {
  it('lists runs by day and opens on the last two runs of the active tab', () => {
    render(<RunComparePanel activeTabId="tab-1" />);
    expect(screen.getByText('4 runs')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    const rows = screen.getAllByTestId('run-compare-row');
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining('Sorting.jsJS · Worker18.9 sQuickSort: [ 1, 1, 2, 3 ]'),
      expect.stringContaining('ERR'),
      expect.stringContaining('JS · Worker2.5 ms'),
      expect.stringContaining('Untitled querySQL · DuckDB13 ms3 rows · city, orders'),
    ]);
    expect((within(rows[1]!).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('run-compare-selected').textContent).toBe('2 selected');
    expect(screen.getByTestId('run-compare-code').textContent).toBe('- const mid = [pivot];+ const mid = arr.filter((x) => x === pivot);');
    expect(screen.getByTestId('run-compare-stdout').textContent).toContain('+ QuickSort: [ 1, 1, 2, 3 ]');
    expect(screen.getByTestId('run-compare-values').textContent).toBe('L11length 6 → length 7');
    expect(screen.getByTestId('run-compare-exit').textContent).toBe('ok → ok · 2.5 ms → 18.9 s');
  });

  it('replaces the earlier pick with a third and clears the selection', async () => {
    render(<RunComparePanel activeTabId="tab-1" />);
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[3]!);
    expect((checkboxes[2] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[3] as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('run-compare-restore')).toBeNull();
    await userEvent.click(screen.getByTestId('run-compare-selected'));
    expect(screen.getByTestId('run-compare-pick').textContent).toBe('Pick two runs to compare.');
  });

  it('restores the earlier run as a named branch tab and pins it as a capsule', async () => {
    const tabsBefore = useEditorStore.getState().tabs.length;
    render(<RunComparePanel activeTabId="tab-1" />);
    await userEvent.click(screen.getByTestId('run-compare-restore'));
    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(tabsBefore + 1);
    const restored = tabs[tabs.length - 1]!;
    expect(restored.content).toBe('const mid = [pivot];');
    expect(restored.name).toMatch(/^Sorting\.js · 12:29/);
    expect(restored.workflowMode).toBe('run');

    await userEvent.click(screen.getByTestId('run-compare-pin'));
    expect(useExecutionHistoryStore.getState().entries.find(entry => entry.id === 'first')?.pinned).toBe(true);
    expect(screen.getByTestId('run-compare-pin').textContent).toBe('Unpin capsule');
    expect(screen.getByText('4 runs · 1 pinned as capsule')).toBeTruthy();
  });

  it('starts empty on a tab without two comparable runs and reads in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<RunComparePanel activeTabId="tab-2" />);
    expect(screen.getByText('4 ejecuciones')).toBeTruthy();
    expect(screen.getByText('Hoy')).toBeTruthy();
    expect(screen.getByTestId('run-compare-pick').textContent).toBe('Elige dos ejecuciones para compararlas.');
  });
});
