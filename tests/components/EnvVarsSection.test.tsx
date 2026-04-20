/**
 * RL-011 Slice C — Settings panel covers the global env-var tier.
 *
 * The Slice B store already has full unit coverage; these component tests
 * pin the rendered affordances (empty state, add form, list + remove,
 * validator error path, precedence hint, and the Spanish locale).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EnvVarsSection } from '@/components/Settings/EnvVarsSection';
import { useEnvVarsStore } from '@/stores/envVarsStore';

describe('EnvVarsSection', () => {
  const initial = useEnvVarsStore.getState();

  beforeEach(async () => {
    useEnvVarsStore.setState(initial, true);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('lingua-env-vars');
    }
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useEnvVarsStore.setState(initial, true);
  });

  it('renders the empty state when no global env vars exist', () => {
    render(<EnvVarsSection />);
    expect(screen.getByTestId('env-vars-empty')).toBeTruthy();
    expect(screen.queryByTestId('env-vars-list')).toBeNull();
    // Precedence hint is always visible so the user knows this is only
    // one of the three tiers.
    expect(screen.getByTestId('env-vars-precedence-note')).toBeTruthy();
  });

  it('adds a valid global env var and clears the draft inputs', async () => {
    const user = userEvent.setup();
    render(<EnvVarsSection />);

    await user.type(screen.getByTestId('env-vars-key-input'), 'FOO');
    await user.type(screen.getByTestId('env-vars-value-input'), 'bar');
    await user.click(screen.getByTestId('env-vars-add-button'));

    expect(useEnvVarsStore.getState().global.FOO).toBe('bar');
    const list = screen.getByTestId('env-vars-list');
    expect(within(list).getByText('FOO')).toBeTruthy();
    expect(within(list).getByText('bar')).toBeTruthy();
    // Drafts reset after a successful add so the next entry starts clean.
    expect((screen.getByTestId('env-vars-key-input') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('env-vars-value-input') as HTMLInputElement).value).toBe('');
  });

  it('surfaces a localized error when the key is blank', async () => {
    const user = userEvent.setup();
    render(<EnvVarsSection />);

    await user.click(screen.getByTestId('env-vars-add-button'));

    expect(screen.getByTestId('env-vars-error').textContent).toContain(
      'Enter a key before adding.'
    );
    expect(useEnvVarsStore.getState().global).toEqual({});
  });

  it('rejects a reserved host variable and surfaces the validator error', async () => {
    const user = userEvent.setup();
    render(<EnvVarsSection />);

    await user.type(screen.getByTestId('env-vars-key-input'), 'PATH');
    await user.type(screen.getByTestId('env-vars-value-input'), 'hostile');
    await user.click(screen.getByTestId('env-vars-add-button'));

    expect(screen.getByTestId('env-vars-error').textContent).toMatch(/POSIX/);
    expect(useEnvVarsStore.getState().global).toEqual({});
  });

  it('renders the empty-string sentinel when the value is empty', async () => {
    useEnvVarsStore.setState({ global: { MASKED: '' } });
    render(<EnvVarsSection />);
    expect(screen.getByText('(empty string)')).toBeTruthy();
  });

  it('removes a global env var through the row button', async () => {
    const user = userEvent.setup();
    useEnvVarsStore.setState({ global: { FOO: 'bar' } });
    render(<EnvVarsSection />);

    await user.click(screen.getByTestId('env-vars-remove-FOO'));
    expect(useEnvVarsStore.getState().global).toEqual({});
    expect(screen.getByTestId('env-vars-empty')).toBeTruthy();
  });

  it('localizes every visible string in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<EnvVarsSection />);

    expect(screen.getByText('Variables de entorno')).toBeTruthy();
    expect(screen.getByText('Aún no hay variables de entorno globales.')).toBeTruthy();
    expect(screen.getByTestId('env-vars-add-button').textContent).toContain('Añadir');
  });
});
