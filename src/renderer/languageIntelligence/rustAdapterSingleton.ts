import { RustLanguageIntelligenceAdapter, type RustAdapterTransport } from './rust';

/**
 * implementation — process-wide singleton for the Rust LSP adapter.
 *
 * The adapter is lazily created so the web build never instantiates it
 * (the bridge is desktop-only). Callers must check `isRustLspAvailable`
 * before touching the singleton. Tests can inject a fake transport via
 * `__setRustAdapterForTesting`.
 */

let singleton: RustLanguageIntelligenceAdapter | null = null;

function defaultTransport(): RustAdapterTransport | null {
  const lsp = window.lingua?.lsp?.rust;
  if (!lsp) return null;
  return {
    request: lsp.request,
    notify: lsp.notify,
    onNotification: lsp.onNotification,
  };
}

export function getRustLspAdapter(): RustLanguageIntelligenceAdapter | null {
  if (singleton) return singleton;
  const transport = defaultTransport();
  if (!transport) return null;
  singleton = new RustLanguageIntelligenceAdapter(transport);
  return singleton;
}

export function isRustLspAvailable(): boolean {
  return Boolean(window.lingua?.lsp?.rust);
}

/** Test seam — only call from tests. */
export function __setRustAdapterForTesting(
  adapter: RustLanguageIntelligenceAdapter | null
): void {
  if (singleton && adapter !== singleton) {
    singleton.dispose();
  }
  singleton = adapter;
}
