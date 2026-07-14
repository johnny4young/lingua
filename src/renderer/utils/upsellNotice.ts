import { useUIStore } from '../stores/uiStore';
import { emitCommand } from '../stores/commandBus';

/**
 * One-stop upsell notice helper so stores/components do not reinvent copy.
 * Pairs with RL-060: callers that block a Free-tier action push through
 * this helper instead of calling `pushStatusNotice` directly, so the copy
 * and the checkout link stay centralized as we iterate on pricing.
 */
export interface UpsellNoticeInput {
  /** i18n key for the primary message — must include a `{{feature}}` slot. */
  messageKey: string;
  /** Localized human-readable feature label interpolated into the message. */
  featureLabel: string;
  /** Optional already-localized extra detail shown under the message. */
  detail?: string;
}

export function pushUpsellNotice(input: UpsellNoticeInput): void {
  useUIStore.getState().pushStatusNotice({
    tone: 'info',
    messageKey: input.messageKey,
    values: { feature: input.featureLabel },
    detail: input.detail,
    actions: [
      {
        labelKey: 'upsell.viewPro',
        onClick: () => emitCommand('settings.openLicense'),
      },
    ],
  });
}
