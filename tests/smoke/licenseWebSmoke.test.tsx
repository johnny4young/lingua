import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';

vi.mock('@/hooks/useRunner', () => ({
  useRunner: () => ({
    run: vi.fn(),
    stop: vi.fn(),
    isRunning: false,
    isInitializing: false,
    loadingMessage: null,
  }),
}));

import { Toolbar } from '@/components/Toolbar/Toolbar';
import { AppChrome } from '@/components/Chrome';
import { AppearanceSection } from '@/components/Settings/AppearanceSection';
import { EditorSection } from '@/components/Settings/EditorSection';
import { ExecutionHistorySection } from '@/components/Settings/ExecutionHistorySection';
import { StatusNoticeBanner } from '@/components/StatusNotice/StatusNoticeBanner';
import { useEditorStore } from '@/stores/editorStore';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';

const initialEditorState = useEditorStore.getState();
const initialExecutionHistoryState = useExecutionHistoryStore.getState();
const initialLicenseState = useLicenseStore.getState();
const initialSettingsState = useSettingsStore.getState();

function setFreeTier() {
  useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
}

function setProTier() {
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
          issuedTo: 'smoke@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

function renderSmoke() {
  // RL-093 Slice 3 — the right-side icon cluster (including
  // <LicenseBadge> and the Developer Utilities entry) moved out of the
  // Toolbar into <AppChrome>. The smoke now renders both so the badge
  // assertion still works; the dev-utilities flow is exercised via
  // dedicated palette + chrome tests.
  const onOpenPalette = vi.fn();
  const onOpenSettings = vi.fn();
  render(
    <>
      <AppChrome onOpenPalette={onOpenPalette} onOpenSettings={onOpenSettings} />
      <Toolbar />
      <ExecutionHistorySection />
      <AppearanceSection />
      <EditorSection />
      <StatusNoticeBanner />
    </>
  );
  return { onOpenPalette, onOpenSettings };
}

describe('web license smoke', () => {
  beforeEach(async () => {
    cleanup();
    initI18n('en');
    await i18next.changeLanguage('en');
    useEditorStore.setState(initialEditorState, true);
    useExecutionHistoryStore.setState(initialExecutionHistoryState, true);
    useLicenseStore.setState(initialLicenseState, true);
    useSettingsStore.setState(initialSettingsState, true);
    useUIStore.setState({ statusNotice: null });
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log("ok")',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js',
    });

    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: {
        platform: 'web',
        getSystemLanguages: vi.fn().mockResolvedValue(['en-US']),
      },
    });
  });

  afterEach(() => {
    cleanup();
    useEditorStore.setState(initialEditorState, true);
    useExecutionHistoryStore.setState(initialExecutionHistoryState, true);
    useLicenseStore.setState(initialLicenseState, true);
    useSettingsStore.setState(initialSettingsState, true);
  });

  it('keeps Free web surfaces locked where the plan says they should be', async () => {
    setFreeTier();
    const user = userEvent.setup();
    renderSmoke();

    expect(screen.getByTestId('license-badge').textContent).toContain('FREE');
    expect(screen.getByText('Recent runs and rerun tools')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'New file language menu' }));
    expect(screen.getByTestId('toolbar-new-file-capability-go').textContent).toContain('PRO');
    await user.click(screen.getByRole('menuitem', { name: /^Go/ }));
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
    expect(screen.getByTestId('status-notice-banner').textContent).toContain(
      'additional language runtimes'
    );

    await user.click(screen.getByTestId('execution-history-unlock'));
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');

    await user.selectOptions(screen.getByTestId('theme-pack-select'), 'solarized-daylight');
    expect(useSettingsStore.getState().themePack).toBe('default');

    await user.selectOptions(screen.getByTestId('editor-font-family-select'), 'Menlo, monospace');
    expect(useSettingsStore.getState().fontFamily).toBe(
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace"
    );
  });

  it('unlocks the same web surfaces on Pro', async () => {
    setProTier();
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 18,
    });
    const user = userEvent.setup();
    const { onOpenPalette } = renderSmoke();

    expect(screen.getByTestId('license-badge').textContent).toContain('PRO');
    expect(screen.getByText('1 run recorded')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'New file language menu' }));
    expect(screen.getByTestId('toolbar-new-file-capability-go').textContent).toContain(
      'Desktop only'
    );
    await user.click(screen.getByRole('menuitem', { name: /^Go/ }));
    expect(useEditorStore.getState().tabs.some(tab => tab.language === 'go')).toBe(true);

    // RL-093 Slice 3 — the dev-utilities entry moved to the command
    // palette; the chrome's search button opens it. Smoke now asserts
    // the chrome search wiring instead.
    await user.click(screen.getByTestId('app-chrome-search'));
    expect(onOpenPalette).toHaveBeenCalledOnce();

    await user.selectOptions(screen.getByTestId('theme-pack-select'), 'solarized-daylight');
    expect(useSettingsStore.getState().themePack).toBe('solarized-daylight');

    await user.selectOptions(screen.getByTestId('editor-font-family-select'), 'Menlo, monospace');
    expect(useSettingsStore.getState().fontFamily).toBe('Menlo, monospace');
  });

  it('renders the locked Free copy coherently in Spanish', async () => {
    setFreeTier();
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    renderSmoke();

    expect(screen.getByText('Historial de ejecuciones')).toBeTruthy();
    expect(screen.getByText('Corridas recientes y re-ejecución')).toBeTruthy();
    expect(screen.getByTestId('execution-history-unlock').textContent).toContain(
      'Desbloquear en Pro'
    );
    expect(screen.getByText('Paquete de tema')).toBeTruthy();
    expect(screen.getByText('Familia tipográfica')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Menú de lenguaje para nuevo archivo' }));
    expect(screen.getByTestId('toolbar-new-file-capability-go').textContent).toContain('PRO');
    await user.click(screen.getByRole('menuitem', { name: /^Go/ }));
    expect(screen.getByTestId('status-notice-banner').textContent).toContain(
      'más runtimes de lenguaje'
    );
  }, 10_000);

  it('renders the unlocked Pro copy coherently in Spanish', async () => {
    setProTier();
    useExecutionHistoryStore.getState().record({
      language: 'javascript',
      status: 'ok',
      durationMs: 18,
    });
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    const { onOpenSettings } = renderSmoke();

    expect(screen.getByText('1 ejecución registrada')).toBeTruthy();
    expect(screen.getByText('Paquete de tema')).toBeTruthy();
    expect(screen.getByText('Familia tipográfica')).toBeTruthy();

    // RL-093 Slice 3 — chrome gear opens Settings in Spanish locale.
    await user.click(screen.getByTestId('app-chrome-settings'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
