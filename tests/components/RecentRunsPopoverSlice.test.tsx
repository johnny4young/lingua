import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { RecentRunsPopover } from '@/components/Editor/RecentRunsPopover';
import type { ExecutionHistoryEntry } from '@/stores/executionHistoryStore';

vi.mock('@/hooks/useRunner', () => ({ useRunner: () => ({ run: vi.fn() }) }));

const entry = (id: string): ExecutionHistoryEntry => ({ id, tabId: 'tab-js', language: 'javascript', status: 'ok', durationMs: 1, timestamp: 100, snapshot: null });

describe('RecentRunsPopover Free slice', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('lists the slice without pin or replay, with the total and a PRO chip', () => {
    render(<RecentRunsPopover entries={[entry('a'), entry('b'), entry('c')]} sliceOf={7} onClose={vi.fn()} />);
    expect(screen.getByTestId('recent-runs-popover').textContent).toContain('7 runs');
    expect(screen.queryByTestId('recent-runs-popover-pin-a')).toBeNull();
    expect(screen.queryByTestId('recent-runs-popover-replay-a')).toBeNull();
    expect(screen.getByTestId('recent-runs-free-slice').textContent).toContain('Free shows the last 3 of 7');
  });

  it('says replay and pins are Pro when every run fits', () => {
    render(<RecentRunsPopover entries={[entry('a')]} sliceOf={1} onClose={vi.fn()} />);
    expect(screen.getByTestId('recent-runs-free-slice').textContent).toContain('Replay and pins are Pro');
  });

  it('keeps pin and replay for Pro', () => {
    render(<RecentRunsPopover entries={[entry('a')]} onClose={vi.fn()} />);
    expect(screen.getByTestId('recent-runs-popover-pin-a')).toBeTruthy();
    expect(screen.queryByTestId('recent-runs-free-slice')).toBeNull();
  });
});
