import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { ToolchainBinaryRow } from '@/components/Settings/ToolchainBinaryRow';
import { resetNativeToolchainStoreForTests, useNativeToolchainStore } from '@/stores/nativeToolchainStore';
import { useUIStore } from '@/stores/uiStore';
import { resetNativeProbeCacheForTests } from '@/utils/nativeProbeCache';

const originalLingua = window.lingua;
const detect = vi.fn();
const chooseBinary = vi.fn();
const chosenBinary = vi.fn();
const clearBinary = vi.fn();

function desktop(platform = 'darwin') {
  Object.defineProperty(window, 'lingua', {
    configurable: true,
    value: { platform, go: { detect, chooseBinary, chosenBinary, clearBinary }, rust: { detect, chooseBinary, chosenBinary, clearBinary } },
  });
}

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  resetNativeToolchainStoreForTests();
  resetNativeProbeCacheForTests();
  useUIStore.setState({ statusNotice: null, statusNoticeQueue: [] });
  detect.mockReset().mockResolvedValue({ installed: true, version: 'go1.22' });
  chooseBinary.mockReset();
  chosenBinary.mockReset().mockResolvedValue({ path: null });
  clearBinary.mockReset().mockResolvedValue({ cleared: true });
  desktop();
});

afterEach(() => {
  Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
});

describe('Settings toolchain binary row', () => {
  it('says Run uses PATH until a binary is chosen', async () => {
    render(<ToolchainBinaryRow toolchain="go" />);
    expect(await screen.findByText('Go binary')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('settings-go-binary-path').textContent).toBe('From PATH'));
    expect(screen.queryByTestId('settings-go-binary-use-path')).toBeNull();
  });

  it('shows the chosen binary and goes back to PATH', async () => {
    chosenBinary.mockResolvedValueOnce({ path: '~/sdk/go/bin/go' }).mockResolvedValue({ path: null });
    render(<ToolchainBinaryRow toolchain="go" />);
    await waitFor(() => expect(screen.getByTestId('settings-go-binary-path').textContent).toBe('~/sdk/go/bin/go'));
    await userEvent.click(screen.getByTestId('settings-go-binary-use-path'));
    expect(clearBinary).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId('settings-go-binary-path').textContent).toBe('From PATH'));
    expect(detect).toHaveBeenCalled();
  });

  it('says why a picked file was refused, and shows a saved one', async () => {
    chooseBinary.mockResolvedValueOnce({ status: 'invalid', reason: 'wrong-name' });
    render(<ToolchainBinaryRow toolchain="rust" />);
    await userEvent.click(screen.getByTestId('settings-rust-binary-choose'));
    expect((await screen.findByTestId('settings-rust-binary-error')).textContent).toBe('Pick the rustc binary.');

    chooseBinary.mockResolvedValueOnce({ status: 'saved', version: 'rustc 1.90.0' });
    chosenBinary.mockResolvedValue({ path: '~/.cargo/bin/rustc' });
    await userEvent.click(screen.getByTestId('settings-rust-binary-choose'));
    await waitFor(() => expect(screen.getByTestId('settings-rust-binary-path').textContent).toBe('~/.cargo/bin/rustc'));
    expect(screen.queryByTestId('settings-rust-binary-error')).toBeNull();
  });

  it('says so when going back to PATH failed', async () => {
    chosenBinary.mockResolvedValue({ path: '~/sdk/go/bin/go' });
    clearBinary.mockResolvedValueOnce({ cleared: false });
    render(<ToolchainBinaryRow toolchain="go" />);
    await userEvent.click(await screen.findByTestId('settings-go-binary-use-path'));
    expect((await screen.findByTestId('settings-go-binary-error')).textContent).toBe('Lingua could not go back to PATH. Try again.');
  });

  it('stays out of the web build', () => {
    desktop('web');
    const { container } = render(<ToolchainBinaryRow toolchain="go" />);
    expect(container.textContent).toBe('');
    expect(chosenBinary).not.toHaveBeenCalled();
  });

  it('keeps the chosen path when a later probe reports the toolchain', async () => {
    chosenBinary.mockResolvedValue({ path: '~/sdk/go/bin/go' });
    await useNativeToolchainStore.getState().loadChoice('go');
    useNativeToolchainStore.getState().report('go', { installed: true });
    expect(useNativeToolchainStore.getState().go.chosenPath).toBe('~/sdk/go/bin/go');
  });
});
