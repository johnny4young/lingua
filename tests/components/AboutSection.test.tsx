import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutSection } from '../../src/renderer/components/Settings/AboutSection';
import { initI18n } from '../../src/renderer/i18n';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUpdateStore } from '../../src/renderer/stores/updateStore';

describe('AboutSection', () => {
  const initialSettingsState = useSettingsStore.getState();
  const initialUpdateState = useUpdateStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialSettingsState, true);
    useUpdateStore.setState(initialUpdateState, true);
    initI18n('en');
    await i18next.changeLanguage('en');
    window.lingua = {
      ...window.lingua,
      platform: 'darwin',
      getAppInfo: vi.fn().mockResolvedValue({
        productName: 'Lingua',
        version: '0.1.0',
        buildDate: '2026-04-16T01:23:45.000Z',
        licenseType: 'MIT',
        repositoryUrl: 'https://example.com/lingua',
      }),
      openExternal: vi.fn(),
    } as unknown as typeof window.lingua;
  });

  it('renders the Take-a-tour button that wires into the startGuidedTour callback', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(<AboutSection onStartGuidedTour={onStart} />);

    await user.click(screen.getByTestId('about-start-tour'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('reflects the inverse of suppressTourAutoStart in the toggle and flips it on click', async () => {
    const user = userEvent.setup();
    render(<AboutSection onStartGuidedTour={vi.fn()} />);

    const toggle = screen
      .getByTestId('settings-show-tour-toggle')
      .querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await user.click(toggle);
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await user.click(toggle);
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(false);
  });

  it('lets users opt out of version notifications', async () => {
    const user = userEvent.setup();
    render(<AboutSection onOpenWhatsNew={vi.fn()} />);

    const toggle = screen
      .getByTestId('settings-whats-new-notices-toggle')
      .querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await user.click(toggle);
    expect(useSettingsStore.getState().whatsNewNotificationsEnabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
});
