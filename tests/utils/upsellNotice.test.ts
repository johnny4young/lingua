import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushUpsellNotice, resetUpsellNoticesForTests } from '../../src/renderer/utils/upsellNotice';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import {
  _resetCommandBusForTesting,
  subscribeCommand,
} from '../../src/renderer/stores/commandBus';

describe('pushUpsellNotice', () => {
  beforeEach(() => {
    resetUpsellNoticesForTests();
    useUIStore.setState({ statusNotice: null, statusNoticeQueue: [] });
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

  it('makes the pitch once per feature and still answers later blocks', () => {
    const block = (featureLabel: string) => pushUpsellNotice({ messageKey: 'upsell.freeCeilingReached', featureLabel });
    block('additional open tabs');
    useUIStore.getState().dismissStatusNotice();

    block('additional open tabs');
    expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'upsell.freeCeilingReached', values: { feature: 'additional open tabs' } });
    expect(useUIStore.getState().statusNotice?.actions).toBeUndefined();
    expect(useUIStore.getState().statusNotice?.priority).toBeUndefined();

    block('run capsules');
    expect(useUIStore.getState().statusNotice?.actions).toHaveLength(1);

    // A different message for the same feature still makes its own pitch.
    useUIStore.getState().dismissStatusNotice();
    pushUpsellNotice({ messageKey: 'upsell.desktopLanguageOnWeb', featureLabel: 'additional open tabs' });
    expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'upsell.desktopLanguageOnWeb' });
    expect(useUIStore.getState().statusNotice?.actions).toHaveLength(1);
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

  it('pitches once a session across features with Pro in context, opening Compare plans', () => {
    useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
    try {
      const compare = vi.fn();
      subscribeCommand('plans.compare', compare);
      pushUpsellNotice({ messageKey: 'upsell.freeCeilingReached', featureLabel: 'additional open tabs' });
      const first = useUIStore.getState().statusNotice!;
      expect(first.actions).toEqual([expect.objectContaining({ labelKey: 'plans.title' })]);
      first.actions![0]!.onClick();
      expect(compare).toHaveBeenCalled();
      useUIStore.setState({ statusNotice: null, statusNoticeQueue: [] });
      pushUpsellNotice({ messageKey: 'upsell.freeCeilingReached', featureLabel: 'more snippets' });
      const second = useUIStore.getState().statusNotice!;
      expect(second.actions).toBeUndefined();
      expect(second.priority).toBeUndefined();
    } finally {
      useSettingsStore.setState({ featureFlags: {} });
    }
  });
});
