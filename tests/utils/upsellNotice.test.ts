import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OPEN_LICENSE_SETTINGS_EVENT,
  pushUpsellNotice,
} from '../../src/renderer/utils/upsellNotice';
import { useUIStore } from '../../src/renderer/stores/uiStore';

describe('pushUpsellNotice', () => {
  beforeEach(() => {
    useUIStore.getState().dismissStatusNotice();
  });

  it('pushes a status notice with the interpolated localized feature label', () => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: 'additional open tabs',
      detail: 'Visit linguacode.dev for pricing and downloads.',
    });

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'upsell.freeCeilingReached',
      values: { feature: 'additional open tabs' },
      detail: 'Visit linguacode.dev for pricing and downloads.',
      actions: [expect.objectContaining({ labelKey: 'upsell.viewPro' })],
    });
  });

  it('routes the shared CTA through the App license-settings event', () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_LICENSE_SETTINGS_EVENT, listener);
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: 'additional open tabs',
    });

    useUIStore.getState().statusNotice?.actions?.[0]?.onClick();

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_LICENSE_SETTINGS_EVENT, listener);
  });
});
