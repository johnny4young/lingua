import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { StatusNoticeBanner } from '../../src/renderer/components/StatusNotice/StatusNoticeBanner';
import { pushMissingNativeToolchainNotice } from '../../src/renderer/runners/nativeToolchainGuidance';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const originalLingua = window.lingua;

describe('StatusNoticeBanner', () => {
  beforeEach(async () => {
    cleanup();
    await i18next.changeLanguage('en');
    useUIStore.setState({ statusNotice: null });
  });

  afterEach(() => {
    Object.defineProperty(window, 'lingua', {
      value: originalLingua,
      writable: true,
      configurable: true,
    });
  });

  it('keeps a replacement notice pushed by a CTA visible', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onClick = vi.fn(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'onboarding.firstSnippet.message',
        values: { shortcut: 'Cmd+Shift+P' },
      });
    });

    useUIStore.getState().pushStatusNotice({
      tone: 'success',
      messageKey: 'onboarding.firstRun.message',
      actions: [{ labelKey: 'onboarding.firstRun.cta', onClick }],
      onDismiss,
    });
    render(<StatusNoticeBanner />);

    await user.click(screen.getByRole('button', { name: 'Save as snippet' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('cta');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'onboarding.firstSnippet.message'
    );
    expect(screen.getByTestId('status-notice-banner').textContent).toContain(
      'Reopen it from Snippets or Cmd+Shift+P'
    );
  });

  it('keeps toolchain recovery actions visible after an unsuccessful retry', async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockResolvedValue(false);
    Object.defineProperty(window, 'lingua', {
      value: { platform: 'darwin', openExternal: vi.fn() },
      writable: true,
      configurable: true,
    });

    pushMissingNativeToolchainNotice('go', retry);
    render(<StatusNoticeBanner />);

    await user.click(screen.getByRole('button', { name: 'Retry detection' }));

    expect(await screen.findByText(/Go is still unavailable/)).toBeTruthy();
    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Installation guide' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Retry detection' })
    ).toBeTruthy();
  });

  it('keeps notices with actions up past the auto-dismiss window', () => {
    vi.useFakeTimers();
    try {
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'onboarding.firstRun.message',
        actions: [{ labelKey: 'onboarding.firstRun.cta', onClick: vi.fn() }],
      });
      render(<StatusNoticeBanner />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('onboarding.firstRun.message');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses auto-dismiss while hovered and resumes on leave', () => {
    vi.useFakeTimers();
    try {
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'onboarding.firstRun.message',
      });
      render(<StatusNoticeBanner />);
      const banner = screen.getByTestId('status-notice-banner');
      fireEvent.mouseEnter(banner);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(useUIStore.getState().statusNotice).not.toBeNull();
      fireEvent.mouseLeave(banner);
      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      expect(useUIStore.getState().statusNotice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
