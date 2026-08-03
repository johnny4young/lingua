import type { RustAdapterTransport } from './rust';
import type { LspLanguageIntelligenceAdapter } from './types';
import { createActivationScopedAdapterLoader } from './createActivationScopedAdapterLoader';

/**
 * implementation — process-wide singleton for the Rust LSP adapter.
 *
 * The bridge probe stays synchronous, but the adapter implementation is
 * imported only after rust-analyzer reports ready. This keeps the desktop-only
 * JSON-RPC normalizer out of every browser and non-Rust startup while the
 * Monaco providers retain a synchronous accessor after activation.
 */

type RustLspAdapter = LspLanguageIntelligenceAdapter & { dispose: () => void };

function defaultTransport(): RustAdapterTransport | null {
  const lsp = window.lingua?.lsp?.rust;
  if (!lsp) return null;
  return {
    request: lsp.request,
    notify: lsp.notify,
    onNotification: lsp.onNotification,
  };
}

const adapters = createActivationScopedAdapterLoader<RustLspAdapter>(async () => {
  const transport = defaultTransport();
  if (!transport) return null;
  const { RustLanguageIntelligenceAdapter } = await import('./rust');
  return new RustLanguageIntelligenceAdapter(transport);
});

export const getRustLspAdapter = adapters.get;
export const loadRustLspAdapter = adapters.load;

export function isRustLspAvailable(): boolean {
  return Boolean(window.lingua?.lsp?.rust);
}

/** Test seam — only call from tests. */
export function __setRustAdapterForTesting(adapter: RustLspAdapter | null): void {
  adapters.setForTesting(adapter);
}
