import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { AppearanceSection } from '../../src/renderer/components/Settings/AppearanceSection';
import { initI18n } from '../../src/renderer/i18n';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

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

describe('AppearanceSection', () => {
  const initialState = useSettingsStore.getState();
  const initialLicense = useLicenseStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialState, true);
    useLicenseStore.setState(initialLicense, true);
    setActiveProLicense();
    useUIStore.setState({ statusNotice: null });
    initI18n('en');
    await i18next.changeLanguage('en');

    Object.defineProperty(window, 'lingua', {
      value: {
        getSystemLanguages: vi.fn().mockResolvedValue(['en-US']),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    useLicenseStore.setState(initialLicense, true);
  });

  it('renders localized appearance copy in Spanish', async () => {
    await i18next.changeLanguage('es');

    render(<AppearanceSection />);

    expect(screen.getByText('Apariencia')).toBeTruthy();
    expect(
      screen.getByText(
        'Lingua aplica presets visuales que mantienen alineados el shell y el editor sin tocar los ajustes de ejecución ni del entorno.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Oscuro')).toBeTruthy();
    expect(screen.getByText('Claro')).toBeTruthy();
  });

  it('updates the persisted language when the selector changes', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    const [, languageSelect] = screen.getAllByRole('combobox');
    await user.selectOptions(languageSelect, 'es');

    await waitFor(() => {
      expect(useSettingsStore.getState().language).toBe('es');
      expect(i18next.language).toBe('es');
    });
  }, 10_000);

  it('applies a theme pack wholesale when the selector changes', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);

    await user.selectOptions(screen.getByTestId('theme-pack-select'), 'solarized-daylight');

    const state = useSettingsStore.getState();
    expect(state.themePack).toBe('solarized-daylight');
    expect(state.theme).toBe('light');
    expect(state.editorTheme).toBe('solarized-light');
  });

  it('flips theme pack back to default when the user edits an appearance field directly', async () => {
    useSettingsStore.getState().applyThemePack('solarized-daylight');

    render(<AppearanceSection />);

    const darkButton = screen.getByRole('button', { name: /Dark/i });
    const user = userEvent.setup();
    await user.click(darkButton);

    const state = useSettingsStore.getState();
    expect(state.themePack).toBe('default');
    expect(state.theme).toBe('dark');
    expect(state.editorTheme).toBe('lingua-dark');
  });

  it('uses the effective editor-derived shell theme for selected appearance buttons', () => {
    useSettingsStore.setState({ theme: 'light', editorTheme: 'lingua-dark' });

    render(<AppearanceSection />);

    expect(screen.getByRole('button', { name: /Dark/i }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: /Light/i }).getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('applies light as a complete shell/editor visual preset from Settings', async () => {
    useSettingsStore.setState({ theme: 'dark', editorTheme: 'dracula' });
    const user = userEvent.setup();
    render(<AppearanceSection />);

    await user.click(screen.getByRole('button', { name: /Light/i }));

    const state = useSettingsStore.getState();
    expect(state.theme).toBe('light');
    expect(state.editorTheme).toBe('lingua-light');
    expect(screen.getByRole('button', { name: /Light/i }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('blocks extended theme packs on the Free tier', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    const user = userEvent.setup();
    render(<AppearanceSection />);

    await user.selectOptions(screen.getByTestId('theme-pack-select'), 'solarized-daylight');

    expect(useSettingsStore.getState().themePack).toBe('default');
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
  });
});
