import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n';
import { RunPolicySection } from '@/components/Settings/RunPolicySection';
import { useSettingsStore } from '@/stores/settingsStore';
import { sanitizeLabsSettings } from '@/stores/settingsLabsSanitizer';

const initialSettings = useSettingsStore.getState();

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

afterEach(() => {
  useSettingsStore.setState(initialSettings, true);
});

describe('run policy settings', () => {
  it('stays hidden until Run state is on in Labs', () => {
    const { container } = render(<RunPolicySection />);
    expect(container.textContent).toBe('');
  });

  it('chooses a policy per language group', async () => {
    useSettingsStore.setState({ featureFlags: { runState: true } });
    render(<RunPolicySection />);
    expect(screen.getByTestId('run-policy-goRust-manual').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByTestId('run-policy-goRust-pause'));
    expect(useSettingsStore.getState().runPolicyByGroup.goRust).toBe('pause');
    expect(screen.getByTestId('run-policy-goRust-pause').getAttribute('aria-pressed')).toBe('true');
  });

  it('reads in Spanish', async () => {
    await i18next.changeLanguage('es');
    useSettingsStore.setState({ featureFlags: { runState: true } });
    render(<RunPolicySection />);
    expect(screen.getByText('Política de ejecución')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Al teclear' })).toHaveLength(3);
  });

  it('restores the defaults for a tampered persisted policy', () => {
    expect(sanitizeLabsSettings({ runPolicyByGroup: { jsTs: 'always' } as never }).runPolicyByGroup).toEqual({
      jsTs: 'keystroke', pythonRuby: 'pause', goRust: 'manual',
    });
  });
});
