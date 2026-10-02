/**
 * runtime-agnostic bridge between the
 * BrowserPreviewPanel UI and the BrowserPreviewRunner.
 *
 * The panel owns the iframe element (it lives in the React tree).
 * The runner is a singleton that needs to write into that iframe
 * (isolated document loading) when an execute call lands. To keep the
 * runner free of React internals, the panel registers its iframe
 * via `setActiveBrowserPreviewIframe(ref)` on mount, and the
 * runner consumes the registered ref via
 * `getActiveBrowserPreviewIframe()`.
 *
 * Mirrors the pattern in `debuggerWorkerBridge.ts`
 * so a follow-up reviewer recognises the shape.
 *
 * Reference: implementation and
 * docs/RUNTIME_MODES_ADR.md § Decision 6.
 */

type IframeRef = HTMLIFrameElement | null;

const ref: { iframe: IframeRef; activator: ((tab: 'browser-preview') => void) | null } = {
  iframe: null,
  activator: null,
};

const mountWaiters = new Set<(iframe: IframeRef) => void>();
const detachListeners = new Set<(iframe: HTMLIFrameElement) => void>();

/**
 * Called by `<BrowserPreviewPanel>` when the iframe mounts /
 * unmounts. The runner consumes the last-registered ref.
 */
export function setActiveBrowserPreviewIframe(iframe: IframeRef): void {
  const previous = ref.iframe;
  ref.iframe = iframe;
  if (previous && previous !== iframe) {
    for (const listener of [...detachListeners]) listener(previous);
  }
  if (iframe) {
    for (const waiter of [...mountWaiters]) waiter(iframe);
  }
}

export function getActiveBrowserPreviewIframe(): IframeRef {
  return ref.iframe;
}

/**
 * Resolves with the registered iframe, waiting up to `timeoutMs` for the
 * panel to mount after `activateBrowserPreviewTab()`. Resolves null on
 * timeout or when `signal` aborts.
 */
export function waitForBrowserPreviewIframe(
  timeoutMs: number,
  signal?: AbortSignal
): Promise<IframeRef> {
  if (ref.iframe) return Promise.resolve(ref.iframe);
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (iframe: IframeRef) => {
      if (timer !== null) clearTimeout(timer);
      mountWaiters.delete(settle);
      signal?.removeEventListener('abort', onAbort);
      resolve(iframe);
    };
    const onAbort = () => settle(null);
    timer = setTimeout(() => settle(null), timeoutMs);
    mountWaiters.add(settle);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Calls `listener` with an iframe once it stops being the registered one
 * (panel unmount or replacement). Returns the unsubscribe function.
 */
export function onBrowserPreviewIframeDetached(
  listener: (iframe: HTMLIFrameElement) => void
): () => void {
  detachListeners.add(listener);
  return () => {
    detachListeners.delete(listener);
  };
}

/**
 * Registered by the AppLayout BottomPanel so the runner can ensure
 * the Browser preview tab is the visible bottom tab when the user
 * fires an execute. Pure indirection — the runner never imports
 * the uiStore directly so it stays renderer-architecture-agnostic.
 */
export function registerBrowserPreviewActivator(
  activator: ((tab: 'browser-preview') => void) | null
): void {
  ref.activator = activator;
}

export function activateBrowserPreviewTab(): void {
  ref.activator?.('browser-preview');
}

/**
 * Reset for tests + module reload. Production code never calls
 * this directly; the panel unmount sets `iframe` to null via
 * `setActiveBrowserPreviewIframe(null)`.
 */
export function _resetBrowserPreviewBridgeForTesting(): void {
  ref.iframe = null;
  ref.activator = null;
  for (const waiter of [...mountWaiters]) waiter(null);
  detachListeners.clear();
}
