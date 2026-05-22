import type { ShareCreateTrigger } from '../../utils/shareLink';

/**
 * Custom event the command palette (fold C), the keyboard shortcut
 * (fold D), AND the result-panel button (fold E) dispatch to ask the
 * always-mounted `<ShareLinkController>` to run the share flow on
 * their behalf. The Controller is the sole owner of the confirmation
 * modal so all entry points share one modal, one clipboard path, and
 * one concurrency guard.
 */
export const SHARE_LINK_TRIGGER_EVENT = 'lingua-share-link-trigger';

export type ShareLinkTriggerEventDetail = {
  readonly trigger: ShareCreateTrigger;
};

/**
 * Custom event the Controller emits after a successful clipboard
 * write. The result-panel button (fold E) listens for it to flash
 * the `Check` icon for 1 second without needing to coordinate React
 * state across the button and controller.
 */
export const SHARE_LINK_SUCCESS_EVENT = 'lingua-share-link-success';
