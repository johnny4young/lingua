import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { ExecutionHistoryPopover } from '../../src/renderer/components/Console/ExecutionHistoryPopover';
import { useExecutionHistoryStore } from '../../src/renderer/stores/executionHistoryStore';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('ExecutionHistoryPopover', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    useExecutionHistoryStore.getState().clear();
  });

  afterEach(() => {
    useExecutionHistoryStore.getState().clear();
  });

  it('renders the empty state when there are no runs', async () => {
    const user = userEvent.setup();
    render(<ExecutionHistoryPopover />);

    await user.click(screen.getByTestId('execution-history-toggle'));

    expect(screen.getByTestId('execution-history-empty')).toBeTruthy();
    expect(
      screen.getByText('No runs recorded yet. Run a file to populate the history.')
    ).toBeTruthy();
  });

  it('lists recorded runs newest-first and formats the duration', async () => {
    // Older entry first so newest-first rendering flips the visual order.
    useExecutionHistoryStore.getState().record({
      language: 'python',
      status: 'ok',
      durationMs: 420,
      timestamp: 1_700_000_000_000,
    });
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 12,
      timestamp: 1_700_000_020_000,
    });

    const user = userEvent.setup();
    render(<ExecutionHistoryPopover />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    const entries = screen.getAllByTestId('execution-history-entry');
    expect(entries).toHaveLength(2);
    // Newest (javascript) should render first.
    expect(entries[0]?.textContent ?? '').toMatch(/javascript/i);
    expect(entries[0]?.textContent ?? '').toMatch(/12 ms/);
    expect(entries[1]?.textContent ?? '').toMatch(/python/i);
    expect(entries[1]?.textContent ?? '').toMatch(/420 ms/);
  });

  it('clicking Replay calls onRerun with the chosen snapshot entry and closes the popover', async () => {
    useExecutionHistoryStore.getState().record({
      language: 'rust',
      status: 'ok',
      durationMs: 77,
      snapshot: { code: 'fn main() {}', language: 'rust' },
    });

    const onRerun = vi.fn();
    const user = userEvent.setup();
    render(<ExecutionHistoryPopover onRerun={onRerun} />);

    await user.click(screen.getByTestId('execution-history-toggle'));
    await user.click(screen.getByTestId('execution-history-rerun'));

    expect(onRerun).toHaveBeenCalledTimes(1);
    expect(onRerun.mock.calls[0]?.[0]).toMatchObject({
      language: 'rust',
      status: 'ok',
      durationMs: 77,
    });
    expect(screen.queryByTestId('execution-history-popover')).toBeNull();
  });

  it('disables Replay for metadata-only entries without a code snapshot', async () => {
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 18,
    });

    const onRerun = vi.fn();
    const user = userEvent.setup();
    render(<ExecutionHistoryPopover onRerun={onRerun} />);

    await user.click(screen.getByTestId('execution-history-toggle'));

    const replay = screen.getByTestId('execution-history-rerun');
    expect((replay as HTMLButtonElement).disabled).toBe(true);
    expect(replay.textContent).toBe('Replay');
    expect(replay.getAttribute('title')).toBe(
      'No code snapshot was captured for this entry.'
    );
    expect(onRerun).not.toHaveBeenCalled();
  });

  it('clear empties the store and returns the popover to the empty state', async () => {
    useExecutionHistoryStore.getState().record({
      language: 'go',
      status: 'error',
      durationMs: null,
    });

    const user = userEvent.setup();
    render(<ExecutionHistoryPopover />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    await user.click(screen.getByTestId('execution-history-clear'));

    expect(useExecutionHistoryStore.getState().entries).toHaveLength(0);
    expect(screen.getByTestId('execution-history-empty')).toBeTruthy();
  });

  it('renders Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    render(<ExecutionHistoryPopover />);

    await user.click(screen.getByTestId('execution-history-toggle'));
    expect(
      screen.getByText(
        'A\u00fan no hay ejecuciones. Ejecuta un archivo para llenar el historial.'
      )
    ).toBeTruthy();
  });

  it('calls onBlocked and stays closed when the entitlement is disabled', async () => {
    const user = userEvent.setup();
    const onBlocked = vi.fn();
    render(<ExecutionHistoryPopover enabled={false} onBlocked={onBlocked} />);

    await user.click(screen.getByTestId('execution-history-toggle'));

    expect(onBlocked).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('execution-history-popover')).toBeNull();
  });
});
