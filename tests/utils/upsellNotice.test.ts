import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushUpsellNotice, resetUpsellNoticesForTests } from '../../src/renderer/utils/upsellNotice';
import { useUIStore } from '../../src/renderer/stores/uiStore';
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
      actions: [expect.objectContaining({ labelKey: 'plans.title' })],
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

  it('makes one pitch a session across features, and still answers later blocks', () => {
    const block = (featureLabel: string) => pushUpsellNotice({ messageKey: 'upsell.freeCeilingReached', featureLabel });
    block('additional open tabs');
    expect(useUIStore.getState().statusNotice?.actions).toHaveLength(1);

    // With the pitch still on screen, the next blocked action answers at once.
    block('run capsules');
    expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'upsell.freeCeilingReached', values: { feature: 'run capsules' } });
    expect(useUIStore.getState().statusNotice?.actions).toBeUndefined();

    pushUpsellNotice({ messageKey: 'upsell.desktopLanguageOnWeb', featureLabel: 'additional open tabs' });
    expect(useUIStore.getState().statusNotice).toMatchObject({ messageKey: 'upsell.desktopLanguageOnWeb' });
    expect(useUIStore.getState().statusNotice?.actions).toBeUndefined();
  });

  it('routes the shared CTA through the Compare plans command', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommand('plans.compare', listener);
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: 'additional open tabs',
    });

    useUIStore.getState().statusNotice?.actions?.[0]?.onClick();

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('pitches once a session across features, opening Compare plans', () => {
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
    expect(second.priority).toBe('high');
  });
});
