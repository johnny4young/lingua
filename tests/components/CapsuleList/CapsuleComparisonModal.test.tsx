/**
 * implementation — CapsuleComparisonModal.
 *
 * Pins: null off-state; summary strip (language match + mismatch, status
 * + duration deltas); implementation note section tabs (Code → Input → Output) with
 * the two panes; implementation note env deltas; the contentIdentical collapse; implementation note
 * a11y (role=dialog + aria-modal, Escape closes, close button is a real
 * <button> with an aria-label); and the ES tuteo locale.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { CapsuleComparisonModal } from '@/components/CapsuleList/CapsuleComparisonModal';
import type { RunCapsuleV1 } from '@/../shared/runCapsule';

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

function capsule(overrides: {
  id?: string;
  language?: string;
  status?: RunCapsuleV1['result']['status'];
  durationMs?: number;
  content?: string;
  stdin?: string;
  stdout?: string;
  platform?: 'web' | 'desktop';
  runner?: string;
}): RunCapsuleV1 {
  return {
    version: 1,
    capsuleId: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-05-21T13:00:00.000Z',
    appVersion: '0.0.0-test',
    tab: {
      name: 'scratchpad',
      language: overrides.language ?? 'javascript',
      runtimeMode: 'worker',
      workflowMode: 'scratchpad',
    },
    source: { content: overrides.content ?? 'console.log(1)', contentHash: 'h' },
    input: overrides.stdin !== undefined ? { stdin: overrides.stdin } : {},
    result: {
      status: overrides.status ?? 'success',
      durationMs: overrides.durationMs ?? 5,
      ...(overrides.stdout !== undefined ? { stdout: overrides.stdout } : {}),
    },
    environment: {
      platform: overrides.platform ?? 'web',
      runner: overrides.runner ?? 'javascript',
    },
    privacy: { redactionVersion: '2026-05-21', omittedFields: [] },
  };
}

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

afterEach(async () => {
  await i18next.changeLanguage('en');
});

describe('CapsuleComparisonModal', () => {
  it('returns null when no capsules are passed (off state)', () => {
    const { container } = render(
      <CapsuleComparisonModal capsules={null} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog with the language-match summary line', () => {
    const older = capsule({ id: 'o', content: 'console.log(1)', durationMs: 10 });
    const newer = capsule({ id: 'n', content: 'console.log(2)', durationMs: 25 });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    expect(screen.getByTestId('capsule-compare-modal')).not.toBeNull();
    expect(
      screen.getByTestId('capsule-compare-summary-language').textContent
    ).toBe('Language: javascript');
    // Duration delta: 25 - 10 = +15 ms.
    expect(
      screen.getByTestId('capsule-compare-summary-duration').textContent
    ).toBe('Duration: 10 ms → 25 ms (+15 ms)');
    // Status line resolves the localized status labels.
    expect(
      screen.getByTestId('capsule-compare-summary-status').textContent
    ).toBe('Status: Success → Success');
  });

  it('flips the language line to mismatch copy when languages differ', () => {
    const older = capsule({ id: 'o', language: 'python', content: 'print(1)' });
    const newer = capsule({ id: 'n', language: 'javascript', content: 'console.log(1)' });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    expect(
      screen.getByTestId('capsule-compare-summary-language').textContent
    ).toBe('Language: python → javascript');
  });

  it('shows env deltas only when they differ (implementation note)', () => {
    const older = capsule({ id: 'o', platform: 'web', runner: 'javascript' });
    const newer = capsule({ id: 'n', platform: 'desktop', runner: 'node-22' });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    expect(
      screen.getByTestId('capsule-compare-summary-platform').textContent
    ).toBe('Platform: web → desktop');
    expect(
      screen.getByTestId('capsule-compare-summary-runner').textContent
    ).toBe('Runner: javascript → node-22');
    // No git posture on either side → no branch chip.
    expect(screen.queryByTestId('capsule-compare-summary-branch')).toBeNull();
  });

  it('hides env chips entirely when the environment matched', () => {
    const older = capsule({ id: 'o', content: 'a', platform: 'web', runner: 'javascript' });
    const newer = capsule({ id: 'n', content: 'b', platform: 'web', runner: 'javascript' });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    expect(screen.queryByTestId('capsule-compare-summary-platform')).toBeNull();
    expect(screen.queryByTestId('capsule-compare-summary-runner')).toBeNull();
  });

  it('renders the Code panes by default and switches sections (implementation note)', async () => {
    const older = capsule({
      id: 'o',
      content: 'console.log(1)',
      stdin: 'older-input',
      stdout: 'older-output',
    });
    const newer = capsule({
      id: 'n',
      content: 'console.log(2)',
      stdin: 'newer-input',
      stdout: 'newer-output',
    });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);
    const user = userEvent.setup();

    // Default = Code: panes show the source.
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(
      'console.log(1)'
    );
    expect(screen.getByTestId('capsule-compare-pane-newer').textContent).toBe(
      'console.log(2)'
    );

    // Switch to Input.
    await user.click(screen.getByTestId('capsule-compare-tab-input'));
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(
      'older-input'
    );
    expect(screen.getByTestId('capsule-compare-pane-newer').textContent).toBe(
      'newer-input'
    );

    // Switch to Output.
    await user.click(screen.getByTestId('capsule-compare-tab-output'));
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(
      'older-output'
    );
    expect(screen.getByTestId('capsule-compare-pane-newer').textContent).toBe(
      'newer-output'
    );
  });

  it('moves between section tabs with the keyboard (accessibility pass)', async () => {
    const older = capsule({
      id: 'o',
      content: 'console.log(1)',
      stdin: 'older-input',
      stdout: 'older-output',
    });
    const newer = capsule({
      id: 'n',
      content: 'console.log(2)',
      stdin: 'newer-input',
      stdout: 'newer-output',
    });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);
    const user = userEvent.setup();

    const codeTab = screen.getByTestId('capsule-compare-tab-code');
    const inputTab = screen.getByTestId('capsule-compare-tab-input');

    // Roving tabindex: only the active tab is in the Tab order.
    expect(codeTab.getAttribute('tabindex')).toBe('0');
    expect(inputTab.getAttribute('tabindex')).toBe('-1');

    // The tab controls a tabpanel labelled by the active tab.
    const panelId = codeTab.getAttribute('aria-controls');
    const panel = document.getElementById(panelId!);
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(codeTab.getAttribute('id'));

    // ArrowRight moves to the next tab with selection following focus.
    codeTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(inputTab);
    expect(inputTab.getAttribute('tabindex')).toBe('0');
    expect(codeTab.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByTestId('capsule-compare-pane-older').textContent).toBe(
      'older-input'
    );
  });

  it('exposes the scroll panes as focusable, labelled regions (accessibility pass)', () => {
    const older = capsule({ id: 'o', content: 'console.log(1)', stdout: 'a' });
    const newer = capsule({ id: 'n', content: 'console.log(2)', stdout: 'b' });
    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    for (const testid of [
      'capsule-compare-pane-older',
      'capsule-compare-pane-newer',
      'capsule-compare-diff-list',
    ]) {
      const region = screen.getByTestId(testid);
      // Keyboard users can Tab into the region and scroll it with arrows.
      expect(region.getAttribute('tabindex')).toBe('0');
      expect(region.getAttribute('role')).toBe('region');
      expect(region.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('disables a section tab whose both sides are empty (no stdin)', () => {
    const older = capsule({ id: 'o', content: 'a' });
    const newer = capsule({ id: 'n', content: 'b' });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    const inputTab = screen.getByTestId('capsule-compare-tab-input') as HTMLButtonElement;
    expect(inputTab.disabled).toBe(true);
  });

  it('collapses to the identical message when content matches (fold)', () => {
    const older = capsule({ id: 'o', content: 'same', stdin: 'in', stdout: 'out' });
    const newer = capsule({ id: 'n', content: 'same', stdin: 'in', stdout: 'out' });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    expect(screen.getByTestId('capsule-compare-identical').textContent).toBe(
      'The two capsules are identical'
    );
    // The tab bar + panes are NOT rendered in the identical state.
    expect(screen.queryByTestId('capsule-compare-tabs')).toBeNull();
    expect(screen.queryByTestId('capsule-compare-pane-older')).toBeNull();
    // The summary strip still renders.
    expect(screen.getByTestId('capsule-compare-summary')).not.toBeNull();
  });

  it('a11y: role=dialog + aria-modal, Escape closes, close is a real button (implementation note)', async () => {
    const onClose = vi.fn();
    const older = capsule({ id: 'o', content: 'a' });
    const newer = capsule({ id: 'n', content: 'b' });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      'capsule-compare-modal-title'
    );

    const close = screen.getByTestId('capsule-compare-close');
    expect(close.tagName).toBe('BUTTON');
    expect(close.getAttribute('aria-label')).toBe('Close comparison');

    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the tuteo Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    const older = capsule({ id: 'o', language: 'python', content: 'print(1)' });
    const newer = capsule({ id: 'n', language: 'javascript', content: 'console.log(1)' });

    render(<CapsuleComparisonModal capsules={[older, newer]} onClose={vi.fn()} />);

    expect(screen.getByText('Comparar cápsulas')).toBeTruthy();
    expect(
      screen.getByTestId('capsule-compare-summary-language').textContent
    ).toBe('Lenguaje: python → javascript');
    // Section tab uses the Spanish label.
    expect(screen.getByTestId('capsule-compare-tab-code').textContent).toBe(
      'Código'
    );
  });
});
