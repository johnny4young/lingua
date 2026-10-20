import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { RunHistoryStrip } from '../../src/renderer/components/Layout/RunHistoryStrip';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';

function seed(runs: Array<{ status: 'ok' | 'error'; durationMs: number | null }>) {
  useExecutionHistoryStore.setState({
    entries: runs.map((run, index) => ({
      id: `r${index}`,
      language: 'javascript',
      timestamp: index,
      snapshot: null,
      ...run,
    })) as never,
  });
}

beforeEach(async () => {
  await initI18n();
  await i18next.changeLanguage('en');
  useExecutionHistoryStore.setState({ entries: [] });
});

describe('RunHistoryStrip', () => {
  it('renders nothing before the first run', () => {
    render(<RunHistoryStrip />);
    expect(screen.queryByTestId('run-history-strip')).toBeNull();
  });

  it('shows the last five runs scaled to the slowest, marking errors and the current run', () => {
    seed([
      { status: 'ok', durationMs: 1 },
      { status: 'ok', durationMs: 10 },
      { status: 'error', durationMs: 3 },
      { status: 'ok', durationMs: 2 },
      { status: 'ok', durationMs: 5 },
      { status: 'ok', durationMs: 5 },
    ]);
    render(<RunHistoryStrip />);
    const bars = screen.getByRole('group', { name: 'Last 5 runs' }).querySelectorAll('button');
    expect(bars).toHaveLength(5);
    expect(bars[0]?.style.height).toBe('100%');
    expect(bars[1]?.getAttribute('data-run-status')).toBe('err');
    expect(bars[1]?.getAttribute('aria-label')).toBe('Run 2 · error');
    expect(bars[4]?.getAttribute('aria-label')).toBe('Run 5 · 5.0 ms, current');
    expect(bars[4]?.getAttribute('data-run-last')).toBe('true');
  });

  it('opens Compare from a bar only when Compare applies', () => {
    seed([{ status: 'ok', durationMs: 4 }]);
    const onCompare = vi.fn();
    const { rerender } = render(<RunHistoryStrip />);
    expect((screen.getByRole('group').querySelector('button') as HTMLButtonElement).disabled).toBe(
      true
    );
    rerender(<RunHistoryStrip onCompare={onCompare} />);
    fireEvent.click(screen.getByRole('group').querySelector('button') as HTMLButtonElement);
    expect(onCompare).toHaveBeenCalledTimes(1);
  });
});
