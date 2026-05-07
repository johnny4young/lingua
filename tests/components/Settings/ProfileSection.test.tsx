import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { ProfileSection } from '@/components/Settings/ProfileSection';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import { useUIStore } from '@/stores/uiStore';

const initialSettings = useSettingsStore.getState();
const initialSnippets = useSnippetsStore.getState();
const initialEnvVars = useEnvVarsStore.getState();
const initialUI = useUIStore.getState();

const VALID_PROFILE = {
  schemaVersion: 1,
  exportedAt: '2026-05-07T14:30:00.000Z',
  appVersion: '0.2.2',
  data: {
    settings: { vimMode: true, fontSize: 20 },
    snippets: [
      {
        id: 'imp-1',
        language: 'javascript',
        label: 'Imported snippet',
        description: '',
        code: 'console.log("hi")',
        createdAt: 1,
      },
    ],
    envVars: { global: { IMPORTED: 'one' }, project: {} },
  },
};

describe('ProfileSection', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let confirmReplaceSpy: ReturnType<typeof vi.fn>;
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(async () => {
    await i18next.changeLanguage('en');

    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURLSpy = vi.fn(() => 'blob:test-url');
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    confirmReplaceSpy = vi.fn(async () => 0);
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: {
        ...(window as Window & { lingua?: unknown }).lingua,
        platform: 'darwin',
        profile: { confirmReplace: confirmReplaceSpy },
      },
    });

    useSettingsStore.setState({ ...initialSettings, vimMode: false }, true);
    useSnippetsStore.setState({ ...initialSnippets, snippets: [] }, true);
    useEnvVarsStore.setState(
      { ...initialEnvVars, global: {}, project: {}, tab: {} },
      true
    );
    useUIStore.setState({ ...initialUI, statusNotice: null });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    useSettingsStore.setState(initialSettings, true);
    useSnippetsStore.setState(initialSnippets, true);
    useEnvVarsStore.setState(initialEnvVars, true);
    useUIStore.setState(initialUI, true);
  });

  it('renders the export and import controls', () => {
    render(<ProfileSection />);
    expect(screen.getByTestId('profile-export-button')).toBeTruthy();
    expect(screen.getByTestId('profile-import-file-button')).toBeTruthy();
  });

  it('Export click triggers a download with the Windows-safe filename', () => {
    render(<ProfileSection />);
    const anchorClicks: HTMLAnchorElement[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      anchorClicks.push(this);
    };
    try {
      fireEvent.click(screen.getByTestId('profile-export-button'));
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toMatch(/^lingua-profile-.*\.json$/);
    expect(anchorClicks[0].download).not.toContain(':');
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('profile.export.success');
  });

  it('paste invalid JSON renders an error notice', async () => {
    render(<ProfileSection />);
    fireEvent.click(screen.getByTestId('profile-import-paste-toggle'));
    const textarea = screen.getByTestId('profile-import-textarea');
    fireEvent.change(textarea, { target: { value: 'not json' } });
    fireEvent.click(screen.getByTestId('profile-import-validate'));
    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'profile.import.error.invalid-json'
      );
    });
    expect(screen.queryByTestId('profile-import-dry-run')).toBeNull();
  });

  it('paste valid JSON renders the dry-run summary and the policy radios', async () => {
    render(<ProfileSection />);
    fireEvent.click(screen.getByTestId('profile-import-paste-toggle'));
    fireEvent.change(screen.getByTestId('profile-import-textarea'), {
      target: { value: JSON.stringify(VALID_PROFILE) },
    });
    fireEvent.click(screen.getByTestId('profile-import-validate'));
    expect(await screen.findByTestId('profile-import-dry-run')).toBeTruthy();
    expect(screen.getByTestId('profile-import-policy-replace')).toBeTruthy();
    expect(screen.getByTestId('profile-import-policy-merge')).toBeTruthy();
    expect(screen.getByTestId('profile-import-policy-preserve')).toBeTruthy();
  });

  it('Apply with replace policy + confirm dialog returning 0 applies the import', async () => {
    render(<ProfileSection />);
    fireEvent.click(screen.getByTestId('profile-import-paste-toggle'));
    fireEvent.change(screen.getByTestId('profile-import-textarea'), {
      target: { value: JSON.stringify(VALID_PROFILE) },
    });
    fireEvent.click(screen.getByTestId('profile-import-validate'));
    await screen.findByTestId('profile-import-dry-run');

    fireEvent.click(screen.getByTestId('profile-import-policy-replace'));
    fireEvent.click(screen.getByTestId('profile-import-apply'));

    await waitFor(() => {
      expect(useSettingsStore.getState().vimMode).toBe(true);
    });
    expect(confirmReplaceSpy).toHaveBeenCalledWith(
      { snippets: 1, envVars: 1 },
      'en'
    );
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
    expect(useEnvVarsStore.getState().global.IMPORTED).toBe('one');
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('profile.import.success');
  });

  it('Apply with replace + confirm dialog cancel (response 1) leaves stores untouched and pushes an explanatory notice', async () => {
    confirmReplaceSpy.mockImplementationOnce(async () => 1);
    render(<ProfileSection />);
    fireEvent.click(screen.getByTestId('profile-import-paste-toggle'));
    fireEvent.change(screen.getByTestId('profile-import-textarea'), {
      target: { value: JSON.stringify(VALID_PROFILE) },
    });
    fireEvent.click(screen.getByTestId('profile-import-validate'));
    await screen.findByTestId('profile-import-dry-run');

    fireEvent.click(screen.getByTestId('profile-import-policy-replace'));
    fireEvent.click(screen.getByTestId('profile-import-apply'));

    await waitFor(() => {
      expect(confirmReplaceSpy).toHaveBeenCalled();
    });
    expect(useSettingsStore.getState().vimMode).toBe(false);
    expect(useSnippetsStore.getState().snippets).toHaveLength(0);
    // RL-089 — surface an explicit notice so the click never reads
    // as a silent no-op (important for the web stub which always
    // returns 1 because there is no native confirm dialog there).
    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'profile.import.replaceCancelled'
      );
    });
  });

  it('merge policy applies WITHOUT a confirm dialog round-trip', async () => {
    render(<ProfileSection />);
    fireEvent.click(screen.getByTestId('profile-import-paste-toggle'));
    fireEvent.change(screen.getByTestId('profile-import-textarea'), {
      target: { value: JSON.stringify(VALID_PROFILE) },
    });
    fireEvent.click(screen.getByTestId('profile-import-validate'));
    await screen.findByTestId('profile-import-dry-run');

    // Default selection is `merge` per the component initial state.
    fireEvent.click(screen.getByTestId('profile-import-apply'));

    await waitFor(() => {
      expect(useSettingsStore.getState().vimMode).toBe(true);
    });
    expect(confirmReplaceSpy).not.toHaveBeenCalled();
  });

  it('file upload flow parses the file and renders the dry-run summary', async () => {
    render(<ProfileSection />);
    const fileInput = screen.getByTestId('profile-import-file') as HTMLInputElement;
    const file = new File(
      [JSON.stringify(VALID_PROFILE)],
      'lingua-profile.json',
      { type: 'application/json' }
    );
    await userEvent.upload(fileInput, file);
    expect(await screen.findByTestId('profile-import-dry-run')).toBeTruthy();
  });

  it('renders the merge policy hint copy that explains the singleton collapse', () => {
    render(<ProfileSection />);
    fireEvent.click(screen.getByTestId('profile-import-paste-toggle'));
    fireEvent.change(screen.getByTestId('profile-import-textarea'), {
      target: { value: JSON.stringify(VALID_PROFILE) },
    });
    fireEvent.click(screen.getByTestId('profile-import-validate'));
    expect(
      screen.getByText(/Settings are singletons/i)
    ).toBeTruthy();
  });

  it('renders ES copy when the locale is set to Spanish (tuteo)', async () => {
    await i18next.changeLanguage('es');
    render(<ProfileSection />);
    expect(screen.getByText('Respaldo del perfil')).toBeTruthy();
    expect(screen.getAllByText(/Descargar JSON del perfil/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Elegir archivo de perfil/i).length).toBeGreaterThan(0);
  });
});
