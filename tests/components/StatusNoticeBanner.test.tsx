import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { StatusNoticeBanner } from '../../src/renderer/components/StatusNotice/StatusNoticeBanner';
import { useUIStore } from '../../src/renderer/stores/uiStore';

describe('StatusNoticeBanner', () => {
  beforeEach(async () => {
    cleanup();
    await i18next.changeLanguage('en');
    useUIStore.setState({ statusNotice: null });
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
});
