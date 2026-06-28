/**
 * UX Sweep T4 — the single polite live region for the app.
 *
 * Mounted once near `StatusNoticeBanner`. Subscribes to the shared
 * {@link useAnnouncerStore} and renders the latest message into a
 * visually-hidden `aria-live="polite"` region so screen readers announce
 * dynamic state changes (result counts, run completion) that are
 * otherwise only conveyed visually.
 *
 * Screen readers announce a live region only when its text content
 * CHANGES, so two identical consecutive messages would be silent the
 * second time. The `nonce` (bumped on every announce) appends a trailing
 * no-break space on alternating announces, guaranteeing the text node
 * mutates on every announce even when the message string is unchanged. A
 * no-break space (not a plain space, which the DOM would collapse) is
 * used so the change is real; it lives inside an `sr-only` region and is
 * never seen.
 */
import { useAnnouncerStore } from '../../stores/announcerStore';

// Non-breaking space appended on alternating announces (escape, not a
// literal, to keep the source free of irregular whitespace).
const TOGGLE_SUFFIX = '\u00A0';

export function LiveAnnouncer() {
  const message = useAnnouncerStore((state) => state.message);
  const nonce = useAnnouncerStore((state) => state.nonce);
  const text = message ? `${message}${nonce % 2 === 0 ? TOGGLE_SUFFIX : ''}` : '';

  return (
    <div
      data-testid="live-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {text}
    </div>
  );
}
