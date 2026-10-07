/**
 * Lazy, shared esbuild-wasm loader for the TypeScript runner and the
 * desktop Node-mode runner.
 *
 * esbuild-wasm's JS shim used to be a STATIC `import * as esbuild` in both
 * runners, which keeps the whole `esbuild-wasm` chunk on the startup import
 * graph (the esbuild-wasm chunk group makes it a separate file, but a static edge
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

/**
 * The first diagnostic's location from an esbuild failure, as one-based line
 * and column. esbuild columns are zero-based, and the message text can hold
 * unrelated numbers, so this reads the structured `errors` array only.
 */
export function esbuildErrorLocation(err: unknown): { line?: number; column?: number } {
  const errors: unknown[] = err && typeof err === 'object' && 'errors' in err && Array.isArray(err.errors)
    ? err.errors : [];
  const first = errors[0];
  const location = first && typeof first === 'object' && 'location' in first ? first.location : null;
  const line = location && typeof location === 'object' && 'line' in location && typeof location.line === 'number'
    ? location.line : undefined;
  const column = location && typeof location === 'object' && 'column' in location && typeof location.column === 'number'
    ? location.column + 1 : undefined;
  return { line, column };
}

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
