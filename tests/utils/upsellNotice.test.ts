import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushUpsellNotice } from '../../src/renderer/utils/upsellNotice';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import {
  _resetCommandBusForTesting,
  subscribeCommand,
} from '../../src/renderer/stores/commandBus';

describe('pushUpsellNotice', () => {
  beforeEach(() => {
    useUIStore.getState().dismissStatusNotice();
  });

  afterEach(() => {
    _resetCommandBusForTesting();
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

  it('routes the shared CTA through the App license-settings command', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommand('settings.openLicense', listener);
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: 'additional open tabs',
    });

    useUIStore.getState().statusNotice?.actions?.[0]?.onClick();

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
