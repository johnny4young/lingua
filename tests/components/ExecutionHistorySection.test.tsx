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

describe('ExecutionHistorySection', () => {
  const initial = useExecutionHistoryStore.getState();

  beforeEach(async () => {
    useExecutionHistoryStore.setState(initial, true);
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useExecutionHistoryStore.setState(initial, true);
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
});
