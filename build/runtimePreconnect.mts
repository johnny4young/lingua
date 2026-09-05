/**
 * Inject a `<link rel="preconnect">` for the origin that serves the oversized
 * web runtimes (DuckDB and Ruby WASM) at build time.
 *
 * Production web builds fetch those payloads from the owned R2 mirror
 * (`VITE_LINGUA_WEB_RUNTIME_BASE`), which is an origin the browser has never
 * seen when the user opens the SQL workspace or runs Ruby — so a 39 MB fetch
 * used to start with a cold DNS lookup and TLS handshake. Same-origin builds
 * (dev, e2e) serve the runtimes locally and must not open a handshake to a
 * host they will never contact, which is why the caller only injects when
 * the external runtime base is in use.
 *
 * The link goes right after the existing first-party preconnects in
 * `src/web/index.html` so the static head keeps one block of connection
 * hints; `crossorigin` because the fetches are CORS.
 */
const ANCHOR = /(<link rel="preconnect" href="https:\/\/updates\.linguacode\.dev" crossorigin \/>)/;

export function injectRuntimePreconnect(html: string, runtimeOrigin: string): string {
  const origin = new URL(runtimeOrigin).origin;
  if (html.includes(`rel="preconnect" href="${origin}"`)) return html;
  const tag = `<link rel="preconnect" href="${origin}" crossorigin />`;
  if (!ANCHOR.test(html)) {
    throw new Error(
      'runtimePreconnect: could not find the updates.linguacode.dev preconnect in index.html to anchor on'
    );
  }
  return html.replace(ANCHOR, `$1\n    ${tag}`);
}
