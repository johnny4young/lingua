/**
 * T19 — runtime context notes for the AI "Explain this error" prompt.
 *
 * Lingua KNOWS where the failing code actually ran (Pyodide vs a native
 * subprocess, a sandboxed worker vs desktop Node, DuckDB-WASM) — a generic
 * model does not. Without this note the model happily suggests fixes the
 * runtime cannot execute (`pip install requests` under Pyodide, `fs` in a
 * browser worker). One sentence of runtime truth is the cheapest quality
 * lever the feature has.
 *
 * Pure and platform-agnostic: the caller supplies the platform (from
 * `window.lingua.platform`) and, for the JS family, the per-tab
 * `runtimeMode`. The note is appended to the USER content by
 * `buildExplainErrorRequest`, so it is always visible in the consent
 * preview — context added here is context the user approves.
 */

import { isJavaScriptFamily } from '../languageFamilies';
import type { RuntimeMode } from '../runtimeModes';

/** Where the app itself runs. Web = browser build; desktop = Electron. */
export type AiPlatform = 'web' | 'desktop';

export interface RuntimeNoteInput {
  /** Language id of the failing code (e.g. `python`, `javascript`, `sql`). */
  readonly language: string;
  /** Current app platform; decides between WASM and native-toolchain notes. */
  readonly platform: AiPlatform;
  /**
   * Per-tab JS/TS runtime mode. Only the JS family carries one; when
   * omitted the JS-family default (`worker`) applies — which matches both
   * fresh tabs and notebook JS cells.
   */
  readonly runtimeMode?: RuntimeMode;
}

const JS_NOTES: Readonly<Record<RuntimeMode, string>> = {
  worker:
    'The code runs in a sandboxed browser Web Worker: no DOM, no Node.js ' +
    'built-ins (fs, path, process, require), network only via fetch and ' +
    'subject to CORS.',
  node:
    'The code runs in a Node.js child process on the user machine: Node ' +
    'built-ins (fs, path, http, process) are available; browser globals ' +
    '(window, document) are not.',
  'browser-preview':
    'The code runs in a sandboxed browser iframe with a DOM: browser ' +
    'globals are available, Node.js built-ins are not.',
};

/**
 * One-sentence description of the runtime the failing code executed in, or
 * `undefined` when Lingua has nothing reliable to say (unknown language).
 */
export function runtimeNoteFor(input: RuntimeNoteInput): string | undefined {
  const { language, platform } = input;

  if (isJavaScriptFamily(language)) {
    return JS_NOTES[input.runtimeMode ?? 'worker'];
  }

  switch (language) {
    case 'python':
      // Pyodide on web AND desktop (see notebookSession / PythonRunner).
      return (
        'Python runs on Pyodide (CPython compiled to WebAssembly): no ' +
        'subprocesses, an in-memory filesystem, and packages install via ' +
        'micropip only (pure-Python or Pyodide-built wheels — arbitrary ' +
        'pip packages with native extensions are unavailable).'
      );
    case 'sql':
      return (
        'The query runs on DuckDB (WebAssembly) locally: DuckDB SQL ' +
        'dialect, tables come from locally registered data, and external ' +
        'database connections are not available.'
      );
    case 'http':
      return platform === 'web'
        ? 'The HTTP request was issued with browser fetch semantics: CORS ' +
            'and mixed-content rules apply, and opaque failures often mean ' +
            'the server did not send CORS headers.'
        : 'The HTTP request was issued from a desktop app (no browser CORS ' +
            'restrictions).';
    case 'go':
      return (
        'Go code compiles and runs as a native subprocess via the local Go ' +
        'toolchain on the user machine.'
      );
    case 'rust':
      return (
        'Rust code compiles and runs as a native subprocess via the local ' +
        'Rust toolchain (rustc/cargo) on the user machine.'
      );
    case 'ruby':
      return platform === 'web'
        ? 'Ruby runs on ruby.wasm (CRuby on WebAssembly) in the browser: no ' +
            'gem installation, no subprocesses, limited filesystem.'
        : 'Ruby runs on ruby.wasm or the local Ruby toolchain depending on ' +
            'the user runtime preference; do not assume arbitrary gems are ' +
            'installed.';
    default:
      return undefined;
  }
}
