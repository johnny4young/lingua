import { beforeEach, describe, expect, it } from 'vitest';
import { pushUpsellNotice } from '../../src/renderer/utils/upsellNotice';
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
    });
  });
});
