/**
 * Node.js type declarations for Monaco's TypeScript worker — one lazy chunk.
 *
 * This module must only ever be reached through `import()` from
 * `./nodeTypeDefinitionsLoader.ts`; `tests/build/monacoInitialGraph.test.ts` fails the build if
 * it becomes statically reachable from either entry. The globs are EAGER on
 * purpose: `@types/node` is ~126 files / ~2.4 MB of raw `.d.ts`, and loading
 * them as 126 lazy `?raw` modules produced a 126-request waterfall on first
 * editor mount, each `await` defeating monaco-typescript's `addExtraLib`
 * resync debounce (252 worker resyncs for one keystroke of intellisense).
 * Inlined here they download as a single request and register synchronously.
 *
 * Who loads it, and when, is decided in `monaco.ts`: desktop builds with the
 * Node runtime pull it on idle after the first editor mount; the web build
 * — where Node code cannot run — waits until a JS/TS model actually refers
 * to Node (`require(`, `process.`, `node:` imports…), so a Python-only or
 * browser-only session never pays the 2.4 MB.
 */

export const NODE_TYPE_DEFINITIONS: Record<string, string> = import.meta.glob<string>(
  [
    '../../node_modules/@types/node/**/*.d.ts',
    '!../../node_modules/@types/node/ts5.6/**/*.d.ts',
    '!../../node_modules/@types/node/ts5.7/**/*.d.ts',
  ],
  {
    eager: true,
    import: 'default',
    query: '?raw',
  }
);

// @types/node v25 references the `undici-types` package for fetch/WebSocket/
// MessageEvent declarations. Register those files beside the Node definitions
// so Monaco's TypeScript worker can resolve bare `undici-types` imports instead
// of surfacing phantom missing-module diagnostics in JS/TS tabs.
export const UNDICI_TYPE_DEFINITIONS: Record<string, string> = import.meta.glob<string>(
  ['../../node_modules/undici-types/**/*.d.ts'],
  {
    eager: true,
    import: 'default',
    query: '?raw',
  }
);
