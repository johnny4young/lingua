/**
 * RL-028 Slice 7 — ExecutionComparisonModal.
 *
 * Pins the side-by-side comparison surface: both panes render the captured
 * code, the summary strip math (language match + duration delta + status),
 * the truncation/clamp warnings fire only when the underlying flags say
 * so, the identical-snapshot empty state collapses the diff list, and
 * Escape closes via the parent callback. Spanish locale is sampled to
 * confirm the tuteo strings flow through.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionHistoryEntry } from '@/stores/executionHistoryStore';
import { initI18n } from '@/i18n';
import { ExecutionComparisonModal } from '@/components/Console/ExecutionComparisonModal';
import { DIFF_MAX_INPUT_CHARS } from '@/utils/diff';

vi.mock('@/components/ui/chrome', () => ({
  IconButton: ({
    children,
    tooltip: _tooltip,
    ...rest
  }: ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }) => (
    <button {...rest}>{children}</button>
  ),
  OverlayBackdrop: ({ children }: { children: ReactNode }) => (
    <div data-testid="overlay-backdrop">{children}</div>
  ),
  OverlayCard: ({ children, ...rest }: HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function makeEntry(overrides: Partial<ExecutionHistoryEntry>): ExecutionHistoryEntry {
  return {
    id: 'entry-x',
    language: 'javascript',
    status: 'ok',
    durationMs: 10,
    timestamp: 1_700_000_000_000,
    snapshot: { code: 'console.log(1)', language: 'javascript', truncated: false },
    ...overrides,
  };
}

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('ExecutionComparisonModal', () => {
  it('returns null when no entries are passed (off state)', () => {
    const onClose = vi.fn();
    const { container } = render(<ExecutionComparisonModal entries={null} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders both code panes and the language-match summary line', () => {
    const older = makeEntry({
      id: 'older-1',
      timestamp: 1_700_000_000_000,
      durationMs: 10,
      snapshot: { code: 'console.log(1)', language: 'javascript', truncated: false },
    });
    const newer = makeEntry({
      id: 'newer-1',
      timestamp: 1_700_000_020_000,
      durationMs: 25,
      snapshot: { code: 'console.log(2)', language: 'javascript', truncated: false },
    });

    render(<ExecutionComparisonModal entries={[older, newer]} onClose={vi.fn()} />);

    const olderPane = screen.getByTestId('execution-compare-pane-older');
    const newerPane = screen.getByTestId('execution-compare-pane-newer');
    expect(olderPane.textContent).toBe('console.log(1)');
    expect(newerPane.textContent).toBe('console.log(2)');

    expect(screen.getByTestId('execution-compare-summary-language').textContent).toBe(
      'Same language: javascript'
    );
    // Duration delta math: 25 - 10 = +15 ms.
    expect(screen.getByTestId('execution-compare-summary-duration').textContent).toBe(
      'Duration: 10 ms → 25 ms (+15 ms)'
    );
    // Status line resolves the i18n status keys.
    expect(screen.getByTestId('execution-compare-summary-status').textContent).toBe(
      'Status: ok → ok'
    );
  });

  it('flips the language line to mismatch copy when languages differ', () => {
    const older = makeEntry({
      id: 'older-2',
      language: 'python',
      snapshot: { code: 'print(1)', language: 'python', truncated: false },
    });
    const newer = makeEntry({
      id: 'newer-2',
      language: 'javascript',
      snapshot: { code: 'console.log(1)', language: 'javascript', truncated: false },
    });

    render(<ExecutionComparisonModal entries={[older, newer]} onClose={vi.fn()} />);

    expect(screen.getByTestId('execution-compare-summary-language').textContent).toBe(
      'Different languages: python → javascript'
    );
  });

  it('renders the truncated warning only when an entry has snapshot.truncated === true', () => {
    const older = makeEntry({
      id: 'older-3',
      snapshot: { code: 'a', language: 'javascript', truncated: false },
    });
    const newer = makeEntry({
      id: 'newer-3',
      snapshot: { code: 'b', language: 'javascript', truncated: true },
    });

    const { rerender } = render(
      <ExecutionComparisonModal
        entries={[
          makeEntry({
            id: 'older-clean',
            snapshot: { code: 'a', language: 'javascript', truncated: false },
          }),
          makeEntry({
            id: 'newer-clean',
            snapshot: { code: 'b', language: 'javascript', truncated: false },
          }),
        ]}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByTestId('execution-compare-summary-truncated')).toBeNull();

    rerender(<ExecutionComparisonModal entries={[older, newer]} onClose={vi.fn()} />);
    expect(screen.getByTestId('execution-compare-summary-truncated')).toBeTruthy();
  });

  it('collapses the diff list to the identical message when both code strings match', () => {
    const code = 'console.log(1)\nconsole.log(2)';
    const older = makeEntry({
      id: 'identical-older',
      snapshot: { code, language: 'javascript', truncated: false },
    });
    const newer = makeEntry({
      id: 'identical-newer',
      snapshot: { code, language: 'javascript', truncated: false },
    });

    render(<ExecutionComparisonModal entries={[older, newer]} onClose={vi.fn()} />);

    expect(screen.getByTestId('execution-compare-diff-identical').textContent).toBe(
      'Both snapshots are identical.'
    );
    expect(screen.queryByTestId('execution-compare-diff-list')).toBeNull();
    // Header still reports zero adds / zero removes.
    expect(screen.getByTestId('execution-compare-diff-header').textContent).toBe(
      '0 added · 0 removed'
    );
  });

  it('emits one diff line per change when the snapshots differ by a single line', () => {
    const older = makeEntry({
      id: 'diff-older',
      snapshot: { code: 'a\nb\nc', language: 'javascript', truncated: false },
    });
    const newer = makeEntry({
      id: 'diff-newer',
      snapshot: { code: 'a\nB\nc', language: 'javascript', truncated: false },
    });

    render(<ExecutionComparisonModal entries={[older, newer]} onClose={vi.fn()} />);

    expect(screen.queryByTestId('execution-compare-diff-identical')).toBeNull();
    const list = screen.getByTestId('execution-compare-diff-list');
    expect(list.textContent).toContain('B');
    expect(screen.queryAllByTestId('execution-compare-diff-line-add').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('execution-compare-diff-line-remove').length).toBeGreaterThan(0);
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    const older = makeEntry({ id: 'esc-older' });
    const newer = makeEntry({ id: 'esc-newer', timestamp: 1_700_000_010_000 });

    render(<ExecutionComparisonModal entries={[older, newer]} onClose={onClose} />);
    const user = userEvent.setup();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the tuteo Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');

    const older = makeEntry({
      id: 'es-older',
      language: 'python',
      snapshot: { code: 'print(1)', language: 'python', truncated: false },
    });
    const newer = makeEntry({
      id: 'es-newer',
      language: 'javascript',
      snapshot: { code: 'console.log(1)', language: 'javascript', truncated: false },
    });

    render(<ExecutionComparisonModal entries={[older, newer]} onClose={vi.fn()} />);

    expect(screen.getByText('Comparar ejecuciones')).toBeTruthy();
    expect(screen.getByTestId('execution-compare-summary-language').textContent).toBe(
      'Lenguajes distintos: python → javascript'
    );
  });

  it('formats the clamped character limit with the active Spanish locale', async () => {
    await i18next.changeLanguage('es');
    const longCode = 'a'.repeat(DIFF_MAX_INPUT_CHARS + 1);
    const older = makeEntry({
      id: 'es-clamp-older',
      snapshot: { code: longCode, language: 'javascript', truncated: false },
    });
    const newer = makeEntry({
      id: 'es-clamp-newer',
      snapshot: { code: `${longCode}b`, language: 'javascript', truncated: false },
    });

    render(<ExecutionComparisonModal entries={[older, newer]} onClose={vi.fn()} />);

    expect(screen.getByTestId('execution-compare-summary-clamped').textContent).toBe(
      'El diff muestra los primeros 40.000 caracteres de cada captura.'
    );
  });
});
