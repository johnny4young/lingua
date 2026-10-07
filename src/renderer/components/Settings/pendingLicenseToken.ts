/**
 * One-shot handoff for a license token delivered by a `lingua://license`
 * deep link. The token only pre-fills the paste field; applying it stays an
 * explicit user action.
 */

type Listener = (token: string) => void;

let pendingToken: string | null = null;
const listeners = new Set<Listener>();

/** Hand the token to a mounted License section, or stash it for the next mount. */
export function offerLicenseTokenPrefill(token: string): void {
  if (listeners.size === 0) {
    pendingToken = token;
    return;
  }
  pendingToken = null;
  for (const listener of listeners) listener(token);
}

/** Non-consuming read for a `useState` initializer, which may render more than once. */
export function peekPendingLicenseToken(): string | null {
  return pendingToken;
}

/**
 * Subscribe a mounted paste field. Returns any token stashed after the
 * initializer ran, and the unsubscribe callback.
 */
export function subscribeLicenseTokenPrefill(listener: Listener): {
  late: string | null;
  unsubscribe: () => void;
} {
  const late = pendingToken;
  pendingToken = null;
  listeners.add(listener);
  return { late, unsubscribe: () => listeners.delete(listener) };
}
