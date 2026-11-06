import { useUIStore } from '../stores/uiStore';
import { emitCommand } from '../stores/commandBus';

/**
 * One-stop upsell notice helper so stores/components do not reinvent copy.
 * Pairs with the tier gates: callers that block a Free-tier action push through
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

// One pitch with its CTA a session, whatever the feature.
let pitched = false;

/** Test hook: a fresh session. */
export function resetUpsellNoticesForTests(): void {
  pitched = false;
}

export function pushUpsellNotice(input: UpsellNoticeInput): void {
  // A blocked action always answers, but only the first one a session makes the pitch.
  if (pitched) {
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: input.messageKey,
      // Replaces the pitch still on screen: this action needs its own answer now.
      priority: 'high',
      values: { feature: input.featureLabel },
    });
    return;
  }
  pitched = true;
  useUIStore.getState().pushStatusNotice({
    tone: 'info',
    messageKey: input.messageKey,
    // A blocked, user-initiated action must explain itself immediately.
    // Match onboarding's high priority so the upsell replaces an ambient
    // onboarding toast instead of being discarded behind it.
    priority: 'high',
    values: { feature: input.featureLabel },
    detail: input.detail,
    actions: [{ labelKey: 'plans.title', onClick: () => emitCommand('plans.compare') }],
  });
}
