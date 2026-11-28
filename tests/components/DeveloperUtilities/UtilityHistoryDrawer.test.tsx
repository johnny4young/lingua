import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UtilityHistoryDrawer } from '@/components/DeveloperUtilities/UtilityHistoryDrawer';
import { useUtilityHistoryStore } from '@/stores/utilityHistoryStore';

const mocks = vi.hoisted(() => ({ entitled: false }));

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => mocks.entitled,
  useEffectiveTier: () => (mocks.entitled ? 'pro' : 'free'),
}));

const token = (claims: Record<string, unknown>) => JSON.stringify(claims, null, 2);
const nowSeconds = () => Math.floor(Date.now() / 1000);

function seed(count: number) {
  const { pushEntry } = useUtilityHistoryStore.getState();
  for (let index = 0; index < count; index += 1) {
    pushEntry('jwt', `eyJhbGciOiJIUzI1NiJ9.payload${index}.sig${index}xyzw`, token({ sub: `svc_${index}`, exp: nowSeconds() + 7200 }));
  }
}

describe('UtilityHistoryDrawer', () => {
  const { togglePersist: realTogglePersist } = useUtilityHistoryStore.getState();

  beforeEach(() => {
    mocks.entitled = false;
    useUtilityHistoryStore.setState({ history: {}, persistEnabled: {}, togglePersist: realTogglePersist });
  });

  afterEach(cleanup);

  it('lists each run with its time, short input, answer and fact', () => {
    useUtilityHistoryStore.getState().pushEntry('jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.pR2Ys', token({ sub: 'svc_deploy' }));
    render(<UtilityHistoryDrawer utilityId="jwt" onApplyEntry={vi.fn()} />);
    const row = screen.getByTestId('utility-history-entry');
    expect(within(row).getByText('eyJhbGci…pR2Ys')).toBeTruthy();
    expect(within(row).getByTestId('utility-history-answer').textContent).toBe('"svc_deploy"');
    expect(within(row).getByTestId('utility-history-answer').dataset.tone).toBe('string');
    expect(within(row).getByTestId('utility-history-fact').textContent).toBe('no exp');
    expect(row.querySelector('time')?.textContent).toMatch(/^\d{2}:\d{2}$/u);
    expect(screen.getByTestId('utility-history-badge').textContent).toBe('Session');
  });

  it('applies a clicked run back into the panel', () => {
    seed(1);
    const onApplyEntry = vi.fn();
    render(<UtilityHistoryDrawer utilityId="jwt" onApplyEntry={onApplyEntry} />);
    fireEvent.click(screen.getByTestId('utility-history-entry'));
    expect(onApplyEntry).toHaveBeenCalledWith(expect.objectContaining({ input: expect.stringContaining('payload0') }));
  });

  it('shows the latest three runs and folds the rest behind Show N more', () => {
    seed(5);
    render(<UtilityHistoryDrawer utilityId="jwt" onApplyEntry={vi.fn()} />);
    expect(screen.getAllByTestId('utility-history-entry')).toHaveLength(3);
    const more = screen.getByTestId('utility-history-more');
    expect(more.textContent).toBe('Show 2 more');
    fireEvent.click(more);
    expect(screen.getAllByTestId('utility-history-entry')).toHaveLength(5);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(more);
    expect(screen.getAllByTestId('utility-history-entry')).toHaveLength(3);
  });

  it('clears the tool and shows the empty state', () => {
    seed(2);
    render(<UtilityHistoryDrawer utilityId="jwt" onApplyEntry={vi.fn()} />);
    fireEvent.click(screen.getByTestId('utility-history-clear'));
    expect(screen.getByTestId('utility-history-empty')).toBeTruthy();
    expect(screen.queryByTestId('utility-history-more')).toBeNull();
    expect((screen.getByTestId('utility-history-clear') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps Save across reloads locked in Free and offers the unlock', () => {
    seed(1);
    render(<UtilityHistoryDrawer utilityId="jwt" onApplyEntry={vi.fn()} />);
    expect((screen.getByTestId('utility-history-persist-toggle') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('utility-history-persist-unlock')).toBeTruthy();
  });

  it('toggles Save across reloads in Pro and names the runs Saved', () => {
    mocks.entitled = true;
    const togglePersist = vi.fn();
    useUtilityHistoryStore.setState({ togglePersist });
    seed(1);
    const { rerender } = render(<UtilityHistoryDrawer utilityId="jwt" onApplyEntry={vi.fn()} />);
    expect(screen.queryByTestId('utility-history-persist-unlock')).toBeNull();
    fireEvent.click(screen.getByTestId('utility-history-persist-toggle'));
    expect(togglePersist).toHaveBeenCalledWith('jwt');
    useUtilityHistoryStore.setState({ persistEnabled: { jwt: true } });
    rerender(<UtilityHistoryDrawer utilityId="jwt" onApplyEntry={vi.fn()} />);
    expect(screen.getByTestId('utility-history-badge').textContent).toBe('Saved');
  });
});
