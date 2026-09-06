/**
 * Integrity helpers for the R2-mirrored runtime WASM payloads (DuckDB, Ruby).
 *
 * The standalone web build fetches those payloads from
 * `downloads.linguacode.dev` and must verify them against the build-time
 * sha256 computed from the pnpm-lock-verified `node_modules` bytes (see
 * `vite.web.config.mts`) before a single byte is instantiated. Two paths
 * exist because the two engines consume the bytes differently:
 *
 * - DuckDB needs a URL (`AsyncDuckDB.instantiate(url)`), so the caller
 *   fetches with a Subresource Integrity `integrity` option built by
 *   {@link sha256HexToIntegrity}. The browser verifies the download off the
 *   main thread and rejects the fetch on mismatch; no JS-side copy or digest.
 * - Ruby compiles a `WebAssembly.Module` inside its worker, so
 *   {@link compileWasmStreamingVerified} tees the body: one branch feeds
 *   `WebAssembly.compileStreaming` so compilation overlaps the download, the
 *   other accumulates bytes for a `crypto.subtle` digest. The module is only
 *   released once the digest matches; compiling is not executing, so a
 *   tampered payload never runs.
 */

const HEX_PAIR_RE = /^[0-9a-f]{64}$/i;

/** Decode a lowercase/uppercase hex sha256 into raw bytes. */
export function sha256HexToBytes(hex: string): Uint8Array {
  if (!HEX_PAIR_RE.test(hex)) {
    throw new Error(`Expected a 64-character hex sha256, got ${JSON.stringify(hex)}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Build the Subresource Integrity metadata (`sha256-<base64>`) for a hex
 * digest, so a build-time hex define can drive `fetch(url, { integrity })`
 * without a second base64 define wired through every Vite config.
 */
export function sha256HexToIntegrity(hex: string): string {
  const bytes = sha256HexToBytes(hex);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Drain a byte stream and return its sha256 as lowercase hex. */
export async function sha256HexOfStream(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytesToHex(await crypto.subtle.digest('SHA-256', joined));
}

export type CompileStreaming = (
  response: Response
) => Promise<WebAssembly.Module>;

/**
 * Compile `response` as WASM while the bytes are still arriving and verify
 * the complete payload against `expectedSha256` (hex). Resolves with the
 * module only when the digest matches; a mismatch rejects with a message
 * naming both hashes so the engine's load-failed band can show it. The
 * synthetic `Response` handed to the compiler carries the `application/wasm`
 * content type `compileStreaming` requires, so the mirror's MIME type is
 * irrelevant. `compileStreaming` is injectable for tests.
 */
export async function compileWasmStreamingVerified(
  response: Response,
  expectedSha256: string,
  label: string,
  compileStreaming: CompileStreaming = (input) => WebAssembly.compileStreaming(input)
): Promise<WebAssembly.Module> {
  if (!response.body) {
    throw new Error(`${label} runtime response has no body to verify.`);
  }
  const [compileBranch, digestBranch] = response.body.tee();
  const compiled = compileStreaming(
    new Response(compileBranch, {
      headers: { 'content-type': 'application/wasm' },
    })
  );
  const digested = sha256HexOfStream(digestBranch);
  // Both branches must settle before deciding: a rejected compile still has
  // to drain the digest branch (tee buffers otherwise), and a bad digest
  // must win over a successfully compiled module.
  const [compileResult, digestResult] = await Promise.allSettled([compiled, digested]);
  if (digestResult.status === 'rejected') throw digestResult.reason;
  const expected = expectedSha256.toLowerCase();
  if (digestResult.value !== expected) {
    throw new Error(
      `${label} runtime integrity check failed: expected sha256 ${expected}, got ${digestResult.value}. ` +
        'The mirrored runtime asset does not match this build.'
    );
  }
  if (compileResult.status === 'rejected') throw compileResult.reason;
  return compileResult.value;
}
