/**
 * Content-Security-Policy headers for the renderer's worker scripts. The page's
 * meta CSP binds the document only; a worker takes its policy from the response
 * that delivered its script, and a header on any other script is ignored.
 */

// Chromium does not treat plain http from the app origin as mixed content, so
// Allow reaches http and ws hosts on the network too, as it did before this header.
const ANY_NETWORK_HOST = 'https: wss: http: ws:';

/**
 * User code. The network policy for running code is chosen per run while this
 * header is fixed per worker, so connect-src stays as wide as Allow and the
 * guard decides per run. Code loads only from the app: AsyncFunction runs JS
 * and TS, Pyodide, ruby.wasm and Go compile WebAssembly, and Go loads its
 * wasm_exec.js from a blob.
 */
export const RUNTIME_WORKER_CSP = [
  "default-src 'none'",
  "script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'",
  `connect-src 'self' blob: data: ${ANY_NETWORK_HOST}`,
  "font-src 'self' data: blob:",
  "worker-src 'self' blob:",
].join('; ');

/** SQL can read a remote file it names, but never runs JavaScript. */
export const SQL_WORKER_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  `connect-src 'self' blob: data: ${ANY_NETWORK_HOST}`,
].join('; ');

/** Editor services and diffing work on text the renderer posts and load nothing else. */
export const TOOLING_WORKER_CSP = ["default-src 'none'", "script-src 'self'", "connect-src 'self'"].join('; ');

/** Each worker entry by the name its built file carries before the content hash. */
export const WORKER_ENTRY_CSP: Readonly<Record<string, string>> = {
  'js-worker': RUNTIME_WORKER_CSP,
  'python-worker': RUNTIME_WORKER_CSP,
  'ruby-worker': RUNTIME_WORKER_CSP,
  'go-worker': RUNTIME_WORKER_CSP,
  'duckdb-browser-eh.worker': SQL_WORKER_CSP,
  'editor.worker': TOOLING_WORKER_CSP,
  'json.worker': TOOLING_WORKER_CSP,
  'css.worker': TOOLING_WORKER_CSP,
  'html.worker': TOOLING_WORKER_CSP,
  'ts.worker': TOOLING_WORKER_CSP,
  'utility-compute-worker': TOOLING_WORKER_CSP,
};

const JAVASCRIPT_FILE = /\.(?:js|mjs|cjs)$/i;
const BUILT_ENTRY = /^assets\/([^/]+)-[A-Za-z0-9_-]{8}\.js$/i;

/**
 * The CSP for a served file, given its path inside the renderer root with `/`
 * separators. Any JavaScript file could start a worker, so one that is not a
 * listed entry gets the runtime policy; other files get none.
 */
export function workerScriptCsp(relativePath: string): string | null {
  if (!JAVASCRIPT_FILE.test(relativePath)) return null;
  const name = BUILT_ENTRY.exec(relativePath)?.[1]?.toLowerCase();
  return name !== undefined && Object.hasOwn(WORKER_ENTRY_CSP, name)
    ? WORKER_ENTRY_CSP[name]!
    : RUNTIME_WORKER_CSP;
}
