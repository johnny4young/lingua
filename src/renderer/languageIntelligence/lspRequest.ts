import type { Result } from '../../shared/result';

export interface LspRequestTransport {
  request: (method: string, params: unknown) => Promise<Result<unknown>>;
}

/**
 * Unwrap the shared IPC Result exactly once for every renderer LSP adapter.
 * Monaco providers intentionally degrade operational failures to an empty
 * completion list or no hover/signature instead of throwing into the editor.
 */
export async function requestLspData(
  transport: LspRequestTransport,
  method: string,
  params: unknown
): Promise<unknown | null> {
  const response = await transport.request(method, params);
  return response.ok ? response.data : null;
}
