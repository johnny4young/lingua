import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { RunSweep } from '../../src/renderer/components/Layout/RunSweep';
import { DockOutputReport } from '../../src/renderer/components/Layout/DockOutputReport';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useResultStore } from '../../src/renderer/stores/resultStore';

const entry = (id: string) =>
  ({ id, language: 'javascript', status: 'ok', durationMs: 1, timestamp: 0, snapshot: null }) as never;

beforeEach(async () => {
  await initI18n();
  await i18next.changeLanguage('en');
});

describe('RunSweep', () => {
  it('plays again for every new run, including once the history is at its cap', () => {
    act(() => useExecutionHistoryStore.setState({ entries: [entry('a'), entry('b')] }));
    render(<RunSweep />);
    const first = screen.getByTestId('run-sweep');
    // Same length, newer run: the capped history dropped one and appended one.
    act(() => useExecutionHistoryStore.setState({ entries: [entry('b'), entry('c')] }));
    expect(screen.getByTestId('run-sweep')).not.toBe(first);
  });

  it('stays out of the editor before the first run', () => {
    act(() => useExecutionHistoryStore.setState({ entries: [] }));
    render(<RunSweep />);
    expect(screen.queryByTestId('run-sweep')).toBeNull();
  });
});

describe('DockOutputReport', () => {
  function openTab(language: string, name: string) {
    act(() => {
      useEditorStore.setState({
        tabs: [{ id: 't', name, language, content: '', isDirty: false }] as never,
        activeTabId: 't',
      });
    });
  }

  it('shows the validation report above the Console rows', () => {
    openTab('json', 'data.json');
    act(() => useResultStore.setState({ fullOutput: 'Line 2: Unexpected token' }));
    render(<DockOutputReport />);
    expect(screen.getByTestId('dock-output-report').textContent).toContain('Unexpected token');
  });

  it('stays hidden for run tabs, whose output streams into Console', () => {
    openTab('javascript', 'main.js');
    act(() => useResultStore.setState({ fullOutput: 'hello' }));
    render(<DockOutputReport />);
    expect(screen.queryByTestId('dock-output-report')).toBeNull();
  });
});
