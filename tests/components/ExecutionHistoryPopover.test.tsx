import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { ExecutionHistoryPopover } from '../../src/renderer/components/Console/ExecutionHistoryPopover';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../src/renderer/stores/executionHistoryStore';

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

  it('moves focus into the popover on open and restores it on close (accessibility pass)', async () => {
    const user = userEvent.setup();
    render(<ExecutionHistoryPopover />);
    const toggle = screen.getByTestId('execution-history-toggle');
    toggle.focus();
    await user.click(toggle);

    const dialog = await screen.findByTestId('execution-history-popover');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    // Escape dismisses and returns focus to the trigger.
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('execution-history-popover')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle);
    });
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

  // ------------------------------------------------------------------
  // implementation — Compare two runs (code diff)
  // ------------------------------------------------------------------

  it('hides the Compare button and the checkbox column when onCompare is not wired', async () => {
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 12,
      snapshot: { code: 'console.log(1)', language: 'javascript' },
    });

    const user = userEvent.setup();
    render(<ExecutionHistoryPopover />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    expect(screen.queryByTestId('execution-history-compare')).toBeNull();
    expect(screen.queryByTestId('execution-history-compare-checkbox')).toBeNull();
    expect(screen.queryByTestId('execution-history-compare-hint')).toBeNull();
  });

  it('renders a checkbox per snapshot-bearing entry and disables it for metadata-only entries', async () => {
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 9,
    });
    useExecutionHistoryStore.getState().record({
      language: 'python',
      status: 'ok',
      durationMs: 22,
      snapshot: { code: 'print(1)', language: 'python' },
    });

    const user = userEvent.setup();
    const onCompare = vi.fn();
    render(<ExecutionHistoryPopover onCompare={onCompare} />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    const checkboxes = screen.getAllByTestId(
      'execution-history-compare-checkbox'
    ) as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    // Newest-first reverse means checkboxes[0] is the python (snapshot) entry
    // and checkboxes[1] is the javascript (no snapshot) entry.
    expect(checkboxes[0]?.disabled).toBe(false);
    expect(checkboxes[1]?.disabled).toBe(true);
  });

  it('toggles the Compare button enabled state across selection counts', async () => {
    for (let i = 0; i < 3; i += 1) {
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 10 + i,
        timestamp: 1_700_000_000_000 + i * 1000,
        snapshot: { code: `// run ${i}`, language: 'javascript' },
      });
    }

    const user = userEvent.setup();
    const onCompare = vi.fn();
    render(<ExecutionHistoryPopover onCompare={onCompare} />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    const compareButton = screen.getByTestId(
      'execution-history-compare'
    ) as HTMLButtonElement;
    const hint = screen.getByTestId('execution-history-compare-hint');

    // 0 selected → disabled with the "select two" hint.
    expect(compareButton.disabled).toBe(true);
    expect(hint.textContent).toBe('Select two runs to compare');

    const checkboxes = screen.getAllByTestId(
      'execution-history-compare-checkbox'
    ) as HTMLInputElement[];

    // Select 1 → still disabled, hint flips.
    await user.click(checkboxes[0]!);
    expect(compareButton.disabled).toBe(true);
    expect(hint.textContent).toBe('Select one more run');

    // Select 2 → enabled, hint cleared.
    await user.click(checkboxes[1]!);
    expect(compareButton.disabled).toBe(false);
    expect(hint.textContent ?? '').toBe('');

    // Select 3 → disabled again, "exactly two" hint.
    await user.click(checkboxes[2]!);
    expect(compareButton.disabled).toBe(true);
    expect(hint.textContent).toBe('Select exactly two runs');
  });

  it('hands oldest→newest entries to onCompare and closes the popover', async () => {
    const olderTimestamp = 1_700_000_000_000;
    const newerTimestamp = 1_700_000_020_000;
    // Record newer first so the visual order (newest-first) does not match
    // the timestamp order — proves the sort is by timestamp, not by visual index.
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 22,
      timestamp: newerTimestamp,
      snapshot: { code: 'console.log(2)', language: 'javascript' },
    });
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 11,
      timestamp: olderTimestamp,
      snapshot: { code: 'console.log(1)', language: 'javascript' },
    });

    const user = userEvent.setup();
    const onCompare = vi.fn();
    render(<ExecutionHistoryPopover onCompare={onCompare} />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    const checkboxes = screen.getAllByTestId(
      'execution-history-compare-checkbox'
    ) as HTMLInputElement[];
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);
    await user.click(screen.getByTestId('execution-history-compare'));

    expect(onCompare).toHaveBeenCalledTimes(1);
    const [older, newer] = onCompare.mock.calls[0]!;
    expect(older.timestamp).toBe(olderTimestamp);
    expect(newer.timestamp).toBe(newerTimestamp);
    // Popover closes on Compare so the modal can claim focus.
    expect(screen.queryByTestId('execution-history-popover')).toBeNull();
  });

  it('uses the numeric id suffix to order entries recorded in the same timestamp bucket', async () => {
    const sameTimestamp = 1_700_000_000_000;
    const entries: ExecutionHistoryEntry[] = [
      {
        id: `${sameTimestamp}-2`,
        language: 'javascript',
        status: 'ok',
        durationMs: 11,
        timestamp: sameTimestamp,
        snapshot: { code: 'console.log(2)', language: 'javascript', truncated: false },
      },
      {
        id: `${sameTimestamp}-10`,
        language: 'javascript',
        status: 'ok',
        durationMs: 22,
        timestamp: sameTimestamp,
        snapshot: { code: 'console.log(10)', language: 'javascript', truncated: false },
      },
    ];
    useExecutionHistoryStore.setState({ entries });

    const user = userEvent.setup();
    const onCompare = vi.fn();
    render(<ExecutionHistoryPopover onCompare={onCompare} />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    const checkboxes = screen.getAllByTestId(
      'execution-history-compare-checkbox'
    ) as HTMLInputElement[];
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);
    await user.click(screen.getByTestId('execution-history-compare'));

    const [older, newer] = onCompare.mock.calls[0]!;
    expect(older.id).toBe(`${sameTimestamp}-2`);
    expect(newer.id).toBe(`${sameTimestamp}-10`);
  });

  it('clears stale compare selection when the history buffer is cleared while open', async () => {
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 10,
      snapshot: { code: 'console.log(1)', language: 'javascript' },
    });
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 20,
      snapshot: { code: 'console.log(2)', language: 'javascript' },
    });

    const user = userEvent.setup();
    const onCompare = vi.fn();
    render(<ExecutionHistoryPopover onCompare={onCompare} />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    const initialCheckboxes = screen.getAllByTestId(
      'execution-history-compare-checkbox'
    ) as HTMLInputElement[];
    await user.click(initialCheckboxes[0]!);
    await user.click(initialCheckboxes[1]!);
    expect((screen.getByTestId('execution-history-compare') as HTMLButtonElement).disabled).toBe(
      false
    );

    await user.click(screen.getByTestId('execution-history-clear'));
    expect(screen.getByTestId('execution-history-empty')).toBeTruthy();

    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 30,
        snapshot: { code: 'console.log(3)', language: 'javascript' },
      });
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 40,
        snapshot: { code: 'console.log(4)', language: 'javascript' },
      });
    });

    expect((screen.getByTestId('execution-history-compare') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByTestId('execution-history-compare-hint').textContent).toBe(
      'Select two runs to compare'
    );
  });

  it('clears the selection when the popover closes and reopens', async () => {
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 10,
      snapshot: { code: 'console.log(1)', language: 'javascript' },
    });

    const user = userEvent.setup();
    const onCompare = vi.fn();
    render(<ExecutionHistoryPopover onCompare={onCompare} />);
    await user.click(screen.getByTestId('execution-history-toggle'));

    const checkbox = screen.getByTestId(
      'execution-history-compare-checkbox'
    ) as HTMLInputElement;
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Close + reopen via the toggle.
    await user.click(screen.getByTestId('execution-history-toggle'));
    await user.click(screen.getByTestId('execution-history-toggle'));

    const reopened = screen.getByTestId(
      'execution-history-compare-checkbox'
    ) as HTMLInputElement;
    expect(reopened.checked).toBe(false);
  });
});
