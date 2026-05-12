import { GoLanguageIntelligenceAdapter, type GoAdapterTransport } from './go';

/**
 * RL-026 Slice 4 — process-wide singleton for the Go LSP adapter.
 *
 * Lazily constructed so the web build never instantiates it against a
 * live transport — `isGoLspAvailable()` short-circuits there. Tests
 * inject a fake transport via `__setGoAdapterForTesting`.
 */

let singleton: GoLanguageIntelligenceAdapter | null = null;

function defaultTransport(): GoAdapterTransport | null {
  const lsp = window.lingua?.lsp?.go;
  if (!lsp) return null;
  return {
    request: lsp.request,
    notify: lsp.notify,
    onNotification: lsp.onNotification,
  };
}

export function getGoLspAdapter(): GoLanguageIntelligenceAdapter | null {
  if (singleton) return singleton;
  const transport = defaultTransport();
  if (!transport) return null;
  singleton = new GoLanguageIntelligenceAdapter(transport);
  return singleton;
}

export function isGoLspAvailable(): boolean {
  return Boolean(window.lingua?.lsp?.go);
}

export function __setGoAdapterForTesting(
  adapter: GoLanguageIntelligenceAdapter | null
): void {
  if (singleton && adapter !== singleton) {
    singleton.dispose();
  }
  singleton = adapter;
}
