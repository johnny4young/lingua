import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { MissingToolchainPanel } from '@/components/Layout/MissingToolchainPanel';
import { resetNativeToolchainStoreForTests, useNativeToolchainStore } from '@/stores/nativeToolchainStore';
import { useUIStore } from '@/stores/uiStore';
import { resetNativeProbeCacheForTests } from '@/utils/nativeProbeCache';

const originalLingua = window.lingua;
const openExternal = vi.fn();
const detect = vi.fn();
const chooseBinary = vi.fn();

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  resetNativeToolchainStoreForTests();
  resetNativeProbeCacheForTests();
  useUIStore.setState({ statusNotice: null, statusNoticeQueue: [] });
  openExternal.mockReset().mockResolvedValue(true);
  detect.mockReset();
  chooseBinary.mockReset();
  Object.defineProperty(window, 'lingua', {
    configurable: true,
    value: { platform: 'darwin', openExternal, go: { detect, chooseBinary }, rust: { detect, chooseBinary } },
  });
  useNativeToolchainStore.getState().report('go', {
    installed: false, reason: 'missing', searched: ['/usr/local/go/bin', '~/go/bin'],
  });
});

afterEach(() => {
  Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
});

describe('missing toolchain Dock state', () => {
  it('names where Lingua looked and opens the installation guide', async () => {
    render(<MissingToolchainPanel toolchain="go" />);
    expect(screen.getByRole('heading', { name: 'Go toolchain not found' })).toBeTruthy();
    expect(screen.getByTestId('missing-toolchain-panel').textContent).toContain(
      'Lingua looked for go on PATH and in /usr/local/go/bin, ~/go/bin.'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Installation guide' }));
    expect(openExternal).toHaveBeenCalledWith('https://linguacode.dev/docs/getting-started');
  });

  it('says why a picked file was refused and keeps the panel', async () => {
    chooseBinary.mockResolvedValueOnce({ status: 'invalid', reason: 'wrong-name' });
    render(<MissingToolchainPanel toolchain="go" />);
    await userEvent.click(screen.getByTestId('missing-toolchain-choose'));
    await waitFor(() => expect(screen.getByTestId('missing-toolchain-feedback').textContent).toBe('Pick the go binary.'));
    expect(detect).not.toHaveBeenCalled();
  });

  it('announces success once a chosen binary is detected', async () => {
    chooseBinary.mockResolvedValueOnce({ status: 'saved', version: 'go version go1.22' });
    detect.mockResolvedValueOnce({ installed: true, version: 'go version go1.22', goRoot: '/opt/go' });
    render(<MissingToolchainPanel toolchain="go" />);
    await userEvent.click(screen.getByTestId('missing-toolchain-choose'));
    await waitFor(() => expect(useNativeToolchainStore.getState().go.status).toBe('installed'));
    expect(useUIStore.getState().statusNotice).toMatchObject({
      messageKey: 'nativeToolchain.retry.detected', values: { toolchain: 'Go' },
    });
  });

  it('reports a binary that is still missing after Detect again', async () => {
    detect.mockResolvedValueOnce({ installed: false, reason: 'missing', searched: ['/usr/local/go/bin'] });
    render(<MissingToolchainPanel toolchain="go" />);
    await userEvent.click(screen.getByTestId('missing-toolchain-detect'));
    await waitFor(() => expect(screen.getByTestId('missing-toolchain-feedback').textContent).toBe('Still not found.'));
    expect(screen.getByTestId('missing-toolchain-panel').textContent).not.toContain('~/go/bin');
  });

  it('falls back to PATH alone and reads in Spanish', async () => {
    await i18next.changeLanguage('es');
    useNativeToolchainStore.getState().report('rust', { installed: false, reason: 'missing' });
    render(<MissingToolchainPanel toolchain="rust" />);
    expect(screen.getByRole('heading', { name: 'No se encontró el toolchain de Rust' })).toBeTruthy();
    expect(screen.getByTestId('missing-toolchain-panel').textContent).toContain('Lingua buscó rustc en el PATH.');
    expect(screen.getByRole('button', { name: 'Elegir binario…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Detectar de nuevo' })).toBeTruthy();
  });
});
