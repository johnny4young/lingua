/**
 * RL-028 second slice — Settings row that exposes the execution history
 * count and a Clear affordance. The Clear button wires to the Slice 1
 * ring-buffer store; no other side effects are possible here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { ExecutionHistorySection } from '@/components/Settings/ExecutionHistorySection';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useUIStore } from '@/stores/uiStore';

function setActiveProLicense() {
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'test@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

describe('ExecutionHistorySection', () => {
  const initial = useExecutionHistoryStore.getState();
  const initialLicense = useLicenseStore.getState();

  beforeEach(async () => {
    useExecutionHistoryStore.setState(initial, true);
    useLicenseStore.setState(initialLicense, true);
    setActiveProLicense();
    useUIStore.setState({ statusNotice: null });
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useExecutionHistoryStore.setState(initial, true);
    useLicenseStore.setState(initialLicense, true);
  });

  it('renders the zero-count state with the Clear button disabled', () => {
    render(<ExecutionHistorySection />);
    expect(screen.getByText('Execution history')).toBeTruthy();
    expect(screen.getByText('0 runs recorded')).toBeTruthy();
    const clear = screen.getByTestId('execution-history-clear');
    expect((clear as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the singular form when exactly one entry is recorded', () => {
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 12,
    });
    render(<ExecutionHistorySection />);
    expect(screen.getByText('1 run recorded')).toBeTruthy();
  });

  it('updates the count as new entries are recorded and enables the Clear button', () => {
    const { record } = useExecutionHistoryStore.getState();
    record({ language: 'javascript', status: 'ok', durationMs: 12 });
    record({ language: 'python', status: 'error', durationMs: 34 });
    record({ language: 'rust', status: 'ok', durationMs: 56 });
    render(<ExecutionHistorySection />);

    expect(screen.getByText('3 runs recorded')).toBeTruthy();
    const clear = screen.getByTestId('execution-history-clear');
    expect((clear as HTMLButtonElement).disabled).toBe(false);
  });

  it('clear button empties the store and flips back to the disabled state', async () => {
    const user = userEvent.setup();
    const { record } = useExecutionHistoryStore.getState();
    record({ language: 'javascript', status: 'ok', durationMs: 12 });
    record({ language: 'python', status: 'error', durationMs: 34 });

    render(<ExecutionHistorySection />);
    await user.click(screen.getByTestId('execution-history-clear'));

    expect(useExecutionHistoryStore.getState().entries).toEqual([]);
    expect(screen.getByText('0 runs recorded')).toBeTruthy();
    const clear = screen.getByTestId('execution-history-clear');
    expect((clear as HTMLButtonElement).disabled).toBe(true);
  });

  it('localizes every visible string in Spanish', async () => {
    await i18next.changeLanguage('es');
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 12,
    });
    render(<ExecutionHistorySection />);

    expect(screen.getByText('Historial de ejecuciones')).toBeTruthy();
    expect(screen.getByText('1 ejecución registrada')).toBeTruthy();
    expect(screen.getByTestId('execution-history-clear').textContent).toContain(
      'Limpiar'
    );
  });

  it('renders a locked state on the Free tier and pushes an upsell notice', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    const user = userEvent.setup();
    render(<ExecutionHistorySection />);

    expect(screen.getByText('Recent runs and rerun tools')).toBeTruthy();
    await user.click(screen.getByTestId('execution-history-unlock'));

    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
  });
});
