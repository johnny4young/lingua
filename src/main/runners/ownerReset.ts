/** Per-renderer resources must end with the document that owns them, not only the WebContents. */

type OwnerResetEvent = 'destroyed' | 'did-navigate' | 'render-process-gone';

export interface ResettableOwner {
  once(event: OwnerResetEvent, listener: () => void): unknown;
  removeListener(event: OwnerResetEvent, listener: () => void): unknown;
}

interface OwnerSubscription {
  readonly callbacks: Set<() => void>;
  readonly listeners: Record<OwnerResetEvent, () => void>;
}

const RESET_EVENTS: readonly OwnerResetEvent[] = ['destroyed', 'did-navigate', 'render-process-gone'];
const subscriptions = new WeakMap<ResettableOwner, OwnerSubscription>();

function detach(owner: ResettableOwner, subscription: OwnerSubscription): void {
  for (const event of RESET_EVENTS) owner.removeListener(event, subscription.listeners[event]);
  if (subscriptions.get(owner) === subscription) subscriptions.delete(owner);
}

/**
 * Runs `callback` when the owner is destroyed, commits a main-frame navigation
 * (a reload keeps the same WebContents), or loses its renderer process. It can
 * fire more than once; the returned function unsubscribes.
 */
export function onOwnerReset(owner: ResettableOwner, callback: () => void): () => void {
  let subscription = subscriptions.get(owner);
  if (!subscription) {
    const callbacks = new Set<() => void>();
    const fire = (): void => {
      for (const reset of [...callbacks]) {
        try {
          reset();
        } catch {
          // One failing disposer must not strand the owner's other resources.
        }
      }
    };
    // once + re-arm instead of on: owners only promise once/removeListener.
    const listeners = {} as Record<OwnerResetEvent, () => void>;
    const created: OwnerSubscription = { callbacks, listeners };
    listeners.destroyed = () => {
      detach(owner, created);
      fire();
    };
    for (const event of ['did-navigate', 'render-process-gone'] as const) {
      listeners[event] = () => {
        if (subscriptions.get(owner) === created) owner.once(event, listeners[event]);
        fire();
      };
    }
    for (const event of RESET_EVENTS) owner.once(event, listeners[event]);
    subscriptions.set(owner, created);
    subscription = created;
  }
  const active = subscription;
  active.callbacks.add(callback);
  return () => {
    active.callbacks.delete(callback);
    if (active.callbacks.size === 0) detach(owner, active);
  };
}
