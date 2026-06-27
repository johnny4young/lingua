/**
 * RL-019 Slice 3 — runtime-agnostic bridge between the
 * BrowserPreviewPanel UI and the BrowserPreviewRunner.
 *
 * The panel owns the iframe element (it lives in the React tree).
 * The runner is a singleton that needs to write into that iframe
 * (`srcdoc` assignment) when an execute call lands. To keep the
 * runner free of React internals, the panel registers its iframe
 * via `setActiveBrowserPreviewIframe(ref)` on mount, and the
 * runner consumes the registered ref via
 * `getActiveBrowserPreviewIframe()`.
 *
 * Mirrors the pattern in `debuggerWorkerBridge.ts` (RL-027 Slice 1)
 * so a follow-up reviewer recognises the shape.
 *
 * Reference: RL-019 Slice 3 and
 * docs/RUNTIME_MODES_ADR.md § Decision 6.
 */

type IframeRef = HTMLIFrameElement | null;

const ref: { iframe: IframeRef; activator: ((tab: 'browser-preview') => void) | null } = {
  iframe: null,
  activator: null,
};

/**
 * Called by `<BrowserPreviewPanel>` when the iframe mounts /
 * unmounts. The runner consumes the last-registered ref.
 */
export function setActiveBrowserPreviewIframe(iframe: IframeRef): void {
  ref.iframe = iframe;
}

export function getActiveBrowserPreviewIframe(): IframeRef {
  return ref.iframe;
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
}
