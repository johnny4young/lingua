import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { _resetCommandBusForTesting } from '@/stores/commandBus';
import { useUIStore } from '@/stores/uiStore';
import { ShareLinkButton, ShareLinkController } from '@/components/Share/ShareLinkButton';

const { prepareShareLinkMock, writeShareLinkMock, trackShareCreatedMock } = vi.hoisted(() => ({
  prepareShareLinkMock: vi.fn(),
  writeShareLinkMock: vi.fn(),
  trackShareCreatedMock: vi.fn(),
}));

vi.mock('@/hooks/useActiveTab', () => ({
  useActiveTab: () => ({
    id: 'tab-share',
    name: 'share.js',
    language: 'javascript',
    content: 'console.log("share")',
    workflowMode: 'scratchpad',
    runtimeMode: 'worker',
    autoLogEnabled: false,
  }),
}));

vi.mock('@/utils/shareLink', () => ({
  bucketShareSize: () => 'small',
  prepareShareLinkFromTab: (...args: unknown[]) => prepareShareLinkMock(...args),
  shareCreateStatusFromPrepareReason: () => 'too-large',
  trackShareCreated: (...args: unknown[]) => trackShareCreatedMock(...args),
  writeShareLinkToClipboard: (...args: unknown[]) => writeShareLinkMock(...args),
}));

describe('ShareLink command bus integration', () => {
  beforeEach(() => {
    initI18n('en');
    useUIStore.setState({ statusNotice: null });
    prepareShareLinkMock.mockResolvedValue({
      ok: true,
      link: {
        url: 'https://app.linguacode.dev/#share=v1.demo',
        fragment: 'share=v1.demo',
        sizeBytes: 128,
        payload: {
          version: 1,
          tab: { name: 'share.js', language: 'javascript' },
          source: { content: 'console.log("share")' },
          modes: {},
          input: {},
        },
      },
    });
    writeShareLinkMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    _resetCommandBusForTesting();
    vi.clearAllMocks();
  });

  it('routes button trigger to the controller and returns success feedback', async () => {
    render(
      <>
        <ShareLinkController />
        <ShareLinkButton />
      </>
    );

    const button = screen.getByTestId('result-panel-share-link');
    fireEvent.click(button);

    expect(await screen.findByTestId('share-confirm-modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('share-confirm-confirm'));

    await waitFor(() => {
      expect(writeShareLinkMock).toHaveBeenCalledWith('https://app.linguacode.dev/#share=v1.demo');
      expect(button.getAttribute('data-just-copied')).toBe('true');
    });
    expect(trackShareCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'button', status: 'success' })
    );
  });
});
