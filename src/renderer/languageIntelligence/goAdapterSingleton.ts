import type { GoAdapterTransport } from './go';
import type { LspLanguageIntelligenceAdapter } from './types';
import { createActivationScopedAdapterLoader } from './createActivationScopedAdapterLoader';

/**
 * implementation — process-wide singleton for the Go LSP adapter.
 *
 * The bridge probe stays synchronous, but the adapter implementation is
 * imported only after gopls reports ready. This keeps the desktop-only
 * JSON-RPC normalizer out of every browser and non-Go startup while the
 * Monaco providers retain a synchronous accessor after activation.
 */

type GoLspAdapter = LspLanguageIntelligenceAdapter & { dispose: () => void };

function defaultTransport(): GoAdapterTransport | null {
  const lsp = window.lingua?.lsp?.go;
  if (!lsp) return null;
  return {
    request: lsp.request,
    notify: lsp.notify,
    onNotification: lsp.onNotification,
  };
}

const adapters = createActivationScopedAdapterLoader<GoLspAdapter>(async () => {
  const transport = defaultTransport();
  if (!transport) return null;
  const { GoLanguageIntelligenceAdapter } = await import('./go');
  return new GoLanguageIntelligenceAdapter(transport);
});

export const getGoLspAdapter = adapters.get;
export const loadGoLspAdapter = adapters.load;

export function isGoLspAvailable(): boolean {
  return Boolean(window.lingua?.lsp?.go);
}

export function __setGoAdapterForTesting(adapter: GoLspAdapter | null): void {
  adapters.setForTesting(adapter);
}
