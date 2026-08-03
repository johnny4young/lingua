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
      priority: 'high',
      values: { feature: 'additional open tabs' },
      detail: 'Visit linguacode.dev for pricing and downloads.',
      actions: [expect.objectContaining({ labelKey: 'upsell.viewPro' })],
    });
  });

  it('replaces an onboarding toast after a user hits a paid boundary', () => {
    useUIStore.getState().pushStatusNotice({
      tone: 'success',
      messageKey: 'onboarding.firstRun.message',
      priority: 'high',
    });

    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: 'additional open tabs',
    });

    expect(useUIStore.getState().statusNotice).toMatchObject({
      messageKey: 'upsell.freeCeilingReached',
      priority: 'high',
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
