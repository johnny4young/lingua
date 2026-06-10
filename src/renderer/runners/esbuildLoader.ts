/**
 * Lazy, shared esbuild-wasm loader for the TypeScript runner and the
 * desktop Node-mode runner.
 *
 * esbuild-wasm's JS shim used to be a STATIC `import * as esbuild` in both
 * runners, which keeps the whole `esbuild-wasm` chunk on the startup import
 * graph (the manualChunks split makes it a separate file, but a static edge
 * still loads it eagerly at boot) — and its module body has side effects
 * that other modules already had to route around (see the import-shape note
 * in `src/renderer/stores/notebookStore.ts`). Importing it dynamically on
 * the first TS / Node-mode run takes it off the boot path entirely.
 *
 * The loader also owns the one-time `initialize` handshake the two runners
 * previously coordinated through duplicated module-level flags: concurrent
 * first calls share a single in-flight promise, a genuine init failure
 * (e.g. offline wasm fetch) clears the promise so the next run can retry,
 * and a double-init throw from esbuild itself is treated as success.
 */

type EsbuildModule = typeof import('esbuild-wasm');

let inFlight: Promise<EsbuildModule> | null = null;

export function loadEsbuild(): Promise<EsbuildModule> {
  if (!inFlight) {
    inFlight = (async () => {
      const esbuild = await import('esbuild-wasm');
      try {
        await esbuild.initialize({
          wasmURL: new URL('esbuild-wasm/esbuild.wasm', import.meta.url).href,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // esbuild throws on a second initialize rather than no-oping;
        // anything else is a real failure and must stay retryable.
        if (!/initialize/i.test(message)) {
          inFlight = null;
          throw err;
        }
      }
      return esbuild;
    })();
  }
  return inFlight;
}
