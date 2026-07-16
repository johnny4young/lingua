import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushMissingNativeToolchainNotice } from '../../src/renderer/runners/nativeToolchainGuidance';
import { useUIStore } from '../../src/renderer/stores/uiStore';

function installShell(platform = 'darwin') {
  const openExternal = vi.fn().mockResolvedValue(true);
  Object.defineProperty(window, 'lingua', {
    value: { platform, openExternal },
    writable: true,
    configurable: true,
  });
  return { openExternal };
}

describe('native toolchain guidance', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useUIStore.setState({ statusNotice: null });
    installShell();
    await i18next.changeLanguage('en');
  });

  it('surfaces install and retry actions on desktop', () => {
    pushMissingNativeToolchainNotice('go', vi.fn().mockResolvedValue(false));

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'warning',
      priority: 'high',
      messageKey: 'nativeToolchain.missing.message',
      values: { toolchain: 'Go' },
      actions: [
        { labelKey: 'nativeToolchain.action.install' },
        { labelKey: 'nativeToolchain.action.retry' },
      ],
    });
  });

  it('replaces a first-run onboarding notice instead of losing recovery actions', () => {
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      priority: 'high',
      messageKey: 'onboarding.notice.firstSnippet',
    });

    pushMissingNativeToolchainNotice('go', vi.fn().mockResolvedValue(false));

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'warning',
      priority: 'high',
      messageKey: 'nativeToolchain.missing.message',
      values: { toolchain: 'Go' },
    });
  });

  it('opens the localized installation guide', async () => {
    const { openExternal } = installShell();
    pushMissingNativeToolchainNotice('rust', vi.fn().mockResolvedValue(false));

    useUIStore.getState().statusNotice?.actions?.[0]?.onClick();

    await vi.waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith(
        'https://linguacode.dev/docs/getting-started'
      );
    });
  });

  it('reports a successful retry without requiring an app restart', async () => {
    const retry = vi.fn().mockResolvedValue(true);
    pushMissingNativeToolchainNotice('node', retry);

    const retryAction = useUIStore.getState().statusNotice?.actions?.[1];
    useUIStore.getState().dismissStatusNotice('cta');
    retryAction?.onClick();

    await vi.waitFor(() => {
      expect(retry).toHaveBeenCalledOnce();
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'success',
        messageKey: 'nativeToolchain.retry.detected',
        values: { toolchain: 'Node.js' },
      });
    });
  });

  it('keeps the recovery guidance out of the web build', () => {
    installShell('web');
    pushMissingNativeToolchainNotice('ruby', vi.fn().mockResolvedValue(false));

    expect(useUIStore.getState().statusNotice).toBeNull();
  });
});
