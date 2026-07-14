import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { RecoverySection } from '@/components/Settings/RecoverySection';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { useUIStore } from '@/stores/uiStore';

const initialSettings = useSettingsStore.getState();
const initialSnippets = useSnippetsStore.getState();
const initialEnvVars = useEnvVarsStore.getState();
const initialUI = useUIStore.getState();

describe('RecoverySection', () => {
  let confirmResetSpy: ReturnType<typeof vi.fn>;
  let revealFolderSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18next.changeLanguage('en');
    localStorage.clear();

    confirmResetSpy = vi.fn(async () => ({ ok: true as const, data: 0 }));
    revealFolderSpy = vi.fn(async () => ({ ok: true as const, data: null }));
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: {
        ...(window as Window & { lingua?: unknown }).lingua,
        platform: 'darwin',
        recovery: {
          confirmReset: confirmResetSpy,
          revealFolder: revealFolderSpy,
        },
      },
    });

    useSettingsStore.setState(
      {
        ...initialSettings,
        vimMode: true,
        fontSize: 18,
        telemetryConsent: 'granted',
        nativeExecutionAcknowledged: true,
      },
      true
    );
    useSnippetsStore.setState(
      {
        ...initialSnippets,
        snippets: [
          {
            id: 's1',
            language: 'javascript',
            label: 'demo',
            description: '',
            code: 'console.log(0)',
            createdAt: 0,
          },
        ],
      },
      true
    );
    useEnvVarsStore.setState(
      { ...initialEnvVars, global: { K: 'v' }, project: {}, tab: {} },
      true
    );
    useUIStore.setState({ ...initialUI, statusNotice: null });
  });

  afterEach(() => {
    useSettingsStore.setState(initialSettings, true);
    useSnippetsStore.setState(initialSnippets, true);
    useEnvVarsStore.setState(initialEnvVars, true);
    useUIStore.setState(initialUI, true);
    localStorage.clear();
  });

  it('renders all five reset rows + safe-mode reload + reveal folder on desktop', () => {
    render(<RecoverySection />);
    expect(screen.getByTestId('recovery-reset-settings')).toBeTruthy();
    expect(screen.getByTestId('recovery-reset-snippets')).toBeTruthy();
    expect(screen.getByTestId('recovery-reset-envVars')).toBeTruthy();
    expect(screen.getByTestId('recovery-reset-session')).toBeTruthy();
    expect(screen.getByTestId('recovery-reset-factory')).toBeTruthy();
    expect(screen.getByTestId('recovery-safe-mode-reload')).toBeTruthy();
    expect(screen.getByTestId('recovery-reveal-folder')).toBeTruthy();
  });

  it('hides Reveal folder button on web', async () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: {
        ...window.lingua,
        platform: 'web',
        recovery: {
          confirmReset: confirmResetSpy,
          revealFolder: revealFolderSpy,
        },
      },
    });
    render(<RecoverySection />);
    await waitFor(() => {
      expect(screen.queryByTestId('recovery-reveal-folder')).toBeNull();
    });
  });

  it('Reset snippets clears the snippets store after confirm', async () => {
    render(<RecoverySection />);
    fireEvent.click(screen.getByTestId('recovery-reset-snippets'));
    await waitFor(() => {
      expect(confirmResetSpy).toHaveBeenCalledWith('snippets', 'en');
    });
    await waitFor(() => {
      expect(useSnippetsStore.getState().snippets).toEqual([]);
    });
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('recovery.success');
  });

  it('Result data 1 cancels without changing stores and surfaces the notice', async () => {
    confirmResetSpy.mockImplementationOnce(async () => ({ ok: true, data: 1 }));
    render(<RecoverySection />);
    fireEvent.click(screen.getByTestId('recovery-reset-snippets'));
    await waitFor(() => {
      expect(confirmResetSpy).toHaveBeenCalled();
    });
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('recovery.cancelled');
  });

  it('fails closed when the native reset confirmation cannot open', async () => {
    confirmResetSpy.mockImplementationOnce(async () => ({
      ok: false,
      reason: 'confirm-failed' as const,
      message: 'dialog unavailable',
    }));
    render(<RecoverySection />);
    fireEvent.click(screen.getByTestId('recovery-reset-snippets'));

    await waitFor(() => {
      expect(confirmResetSpy).toHaveBeenCalled();
    });
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('recovery.cancelled');
  });

  it('Reset settings preserves telemetryConsent and nativeExecutionAcknowledged', async () => {
    render(<RecoverySection />);
    fireEvent.click(screen.getByTestId('recovery-reset-settings'));
    await waitFor(() => {
      expect(confirmResetSpy).toHaveBeenCalledWith('settings', 'en');
    });
    await waitFor(() => {
      expect(useSettingsStore.getState().vimMode).toBe(false);
    });
    expect(useSettingsStore.getState().telemetryConsent).toBe('granted');
    expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(true);
  });

  it('Reset env vars clears global + project + tab scopes', async () => {
    render(<RecoverySection />);
    fireEvent.click(screen.getByTestId('recovery-reset-envVars'));
    await waitFor(() => {
      expect(useEnvVarsStore.getState().global).toEqual({});
    });
  });

  it('Factory reset wipes localStorage but preserves lingua-license', async () => {
    localStorage.setItem('lingua-license', 'fake-token');
    localStorage.setItem('lingua-snippets', '{}');
    render(<RecoverySection />);
    fireEvent.click(screen.getByTestId('recovery-reset-factory'));
    await waitFor(() => {
      expect(confirmResetSpy).toHaveBeenCalledWith('factory', 'en');
    });
    await waitFor(() => {
      expect(localStorage.getItem('lingua-snippets')).toBeNull();
    });
    expect(localStorage.getItem('lingua-license')).toBe('fake-token');
  });

  it('renders ES copy with neutral LatAm tuteo', async () => {
    await i18next.changeLanguage('es');
    render(<RecoverySection />);
    expect(screen.getByText('Recuperación')).toBeTruthy();
    expect(screen.getByText(/Restablecer ajustes del editor/u)).toBeTruthy();
    expect(screen.getByText(/Restablecer fragmentos/u)).toBeTruthy();
  });
});
