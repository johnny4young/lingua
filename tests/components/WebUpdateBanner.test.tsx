/**
 * implementation — pin the WebUpdateBanner UX contract.
 *
 *   1. Renders nothing when the polling hook returns no remote version.
 *   2. Renders nothing when the remote version is the same as or older
 *      than the build-time pin.
 *   3. Renders the banner with the version interpolated into the body
 *      copy when the remote version is strictly newer.
 *   4. Reload button calls `window.location.reload`.
 *   5. Dismiss hides the banner for the rest of the mount; a remount
 *      re-evaluates and re-shows.
 *   6. i18n: en + es tuteo strings render under each locale.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { WebUpdateBanner } from '@/components/WebUpdateBanner';

// `vi.mock` is hoisted by vitest, so the path has to be a literal —
// can't reference an outer constant. Keep these aligned manually.
vi.mock('@/hooks/useWebVersionPolling', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useWebVersionPolling')>(
    '@/hooks/useWebVersionPolling',
  );
  return {
    ...actual,
    useWebVersionPolling: vi.fn(),
  };
});

beforeEach(async () => {
  initI18n('en');
  await act(async () => {
    await i18next.changeLanguage('en');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setHookState(
  state: { remoteVersion: string | null; pinnedVersion: string },
): Promise<void> {
  const mod = await import('@/hooks/useWebVersionPolling');
  vi.mocked(mod.useWebVersionPolling).mockReturnValue(state);
}

describe('WebUpdateBanner', () => {
  it('renders nothing when there is no remote version', async () => {
    await setHookState({ remoteVersion: null, pinnedVersion: '0.3.0' });
    render(<WebUpdateBanner />);
    expect(screen.queryByTestId('web-update-banner')).toBeNull();
  });

  it('renders nothing when remote === pinned', async () => {
    await setHookState({ remoteVersion: '0.3.1', pinnedVersion: '0.3.1' });
    render(<WebUpdateBanner />);
    expect(screen.queryByTestId('web-update-banner')).toBeNull();
  });

  it('renders nothing when remote is older than pinned (no downgrade prompts)', async () => {
    await setHookState({ remoteVersion: '0.3.0', pinnedVersion: '0.4.0' });
    render(<WebUpdateBanner />);
    expect(screen.queryByTestId('web-update-banner')).toBeNull();
  });

  it('renders the banner with the version interpolated when remote is newer', async () => {
    await setHookState({ remoteVersion: '0.4.0', pinnedVersion: '0.3.1' });
    render(<WebUpdateBanner />);
    const banner = screen.getByTestId('web-update-banner');
    expect(banner.textContent).toContain('0.4.0');
    expect(banner.textContent).toContain('A new version of Lingua is available');
  });

  it('reload button calls window.location.reload', async () => {
    await setHookState({ remoteVersion: '0.4.0', pinnedVersion: '0.3.0' });
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
      configurable: true,
    });

    render(<WebUpdateBanner />);
    fireEvent.click(screen.getByTestId('web-update-banner-reload'));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('dismiss hides the banner for the remainder of the mount', async () => {
    await setHookState({ remoteVersion: '0.4.0', pinnedVersion: '0.3.0' });
    render(<WebUpdateBanner />);
    expect(screen.queryByTestId('web-update-banner')).toBeTruthy();

    fireEvent.click(screen.getByTestId('web-update-banner-dismiss'));
    expect(screen.queryByTestId('web-update-banner')).toBeNull();
  });

  it('renders ES tuteo copy under es locale', async () => {
    await act(async () => {
      await i18next.changeLanguage('es');
    });
    try {
      await setHookState({ remoteVersion: '0.4.0', pinnedVersion: '0.3.0' });
      render(<WebUpdateBanner />);
      const banner = screen.getByTestId('web-update-banner');
      expect(banner.textContent).toContain('Hay una nueva versión de Lingua disponible');
      // Tuteo: "Recarga", not "Recargá".
      expect(banner.textContent).toContain('Recarga para obtener la versión 0.4.0');
      // Reload button copy is "Recargar" (infinitive form is universal).
      expect(banner.textContent).toContain('Recargar');
    } finally {
      await act(async () => {
        await i18next.changeLanguage('en');
      });
    }
  });
});
