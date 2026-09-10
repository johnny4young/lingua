/**
 * Which runtime modes actually reach an esbuild-backed transpile.
 *
 * `CodeEditor` warms the TypeScript toolchain on idle, and that warm is worth a
 * ~14 MB WebAssembly download only for modes that will use it. Browser Preview,
 * Deno and Bun never do: `BrowserPreviewRunner.init` is a no-op and
 * `AltJsRunner` executes TypeScript natively, sending the raw source across IPC.
 *
 * Getting this wrong is silent — the warm still "works", it just downloads a
 * toolchain the run discards — so the mapping is pinned here.
 */

import { describe, expect, it } from 'vitest';
import {
  RUNTIME_MODES,
  runtimeModeTranspilesTypeScript,
  type RuntimeMode,
} from '../../src/shared/runtimeModes';

describe('runtimeModeTranspilesTypeScript', () => {
  it('covers the worker and desktop Node runners', () => {
    expect(runtimeModeTranspilesTypeScript('worker')).toBe(true);
    expect(runtimeModeTranspilesTypeScript('node')).toBe(true);
  });

  it('excludes the modes whose runners never call loadEsbuild', () => {
    expect(runtimeModeTranspilesTypeScript('browser-preview')).toBe(false);
    expect(runtimeModeTranspilesTypeScript('deno')).toBe(false);
    expect(runtimeModeTranspilesTypeScript('bun')).toBe(false);
  });

  it('treats an unset mode as the worker default', () => {
    // A tab that never touched the runtime selector carries no mode, and the
    // manager resolves that to the worker runner.
    expect(runtimeModeTranspilesTypeScript(undefined)).toBe(true);
  });

  it('classifies every mode, so a new one cannot slip through unclassified', () => {
    const classified = RUNTIME_MODES.map((mode: RuntimeMode) => ({
      mode,
      transpiles: runtimeModeTranspilesTypeScript(mode),
    }));

    expect(classified).toEqual([
      { mode: 'worker', transpiles: true },
      { mode: 'node', transpiles: true },
      { mode: 'browser-preview', transpiles: false },
      { mode: 'deno', transpiles: false },
      { mode: 'bun', transpiles: false },
    ]);
  });
});
