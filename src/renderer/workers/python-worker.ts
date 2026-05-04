/**
 * Python execution Web Worker using Pyodide (CPython compiled to WASM).
 *
 * Loads Pyodide on first use, caches in memory for subsequent runs,
 * captures stdout/stderr, and sends results to the main thread.
 *
 * RL-083 Slice 1 — desktop/dev resolve `pyodide.mjs` against the
 * renderer build output (file:// in packaged Electron, the dev server
 * origin in `npm run dev:desktop`). The build pipeline copies
 * `node_modules/pyodide/*` to `<outDir>/pyodide/` via
 * `build/copyRuntimeAssetsPlugin.mts`. The web build explicitly
 * overrides the index URL to the CDN until Slice 2 picks the
 * first-party hosting path.
 *
 * RL-078: this worker no longer schedules its own deadline. The
 * parent renderer thread owns a kill timer and calls
 * `worker.terminate()` if user code does not yield in time. Each
 * `execute` request carries a `runId` that the worker echoes on
 * every reply so the parent can drop messages from a previous
 * (terminated) run.
 */

import { syncUserEnvInPyodide } from './python-worker-env';
import { truncateSerialized } from '../runners/limits';

const ctx = self as unknown as Worker;

// Renderer-relative URL of the locally-served Pyodide directory.
//
// In packaged Electron the worker chunk lives at
// `<outDir>/assets/workers-XYZ.js` and `../pyodide/` resolves to
// `<outDir>/pyodide/`, where `build/copyRuntimeAssetsPlugin.mts`
// copies the files at build time.
//
// In `npm run dev:desktop` Vite serves the worker source at
// `/src/renderer/workers/python-worker.ts`, so `../pyodide/` lands at
// `/src/renderer/pyodide/` — the same plugin's `configureServer`
// middleware serves the same files there from `node_modules/pyodide/`.
//
// Keep this as a runtime URL instead of asking Vite to fingerprint a
// directory. The copy plugin owns the actual files, and the web build
// may override the URL to the CDN before this fallback is used.
const RAW_PYODIDE_INDEX_URL = new URL(
  /* @vite-ignore */ '../pyodide/',
  import.meta.url
).href;

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolvePyodideIndexUrl(): string {
  const configuredUrl =
    typeof __LINGUA_PYODIDE_INDEX_URL__ === 'string'
      ? __LINGUA_PYODIDE_INDEX_URL__.trim()
      : '';
  return withTrailingSlash(configuredUrl || RAW_PYODIDE_INDEX_URL);
}

const PYODIDE_INDEX_URL = resolvePyodideIndexUrl();

let pyodide: unknown = null;
let appliedUserEnvKeys: string[] = [];
let activeRunId: string | null = null;

const FALLBACK_RESULT_TRUNCATION_MARKER = '[result truncated]';

function truncate(value: string, marker: string): string {
  return truncateSerialized(value, marker);
}

type PyodideRuntime = {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout?: (options: { batched: (text: string) => void }) => void;
  setStderr?: (options: { batched: (text: string) => void }) => void;
  globals: {
    set(name: string, value: unknown): void;
    delete?(name: string): void;
  };
};

type PyodideLoaderModule = {
  loadPyodide: (options: { indexURL: string }) => Promise<unknown>;
};

async function loadPyodide(): Promise<unknown> {
  if (pyodide) return pyodide;

  // Module workers cannot use importScripts. Load Pyodide's ESM entry
  // from the locally-served copy so Electron, the dev server, and the
  // packaged renderer all read from the same origin.
  const { loadPyodide } = (await import(
    /* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`
  )) as PyodideLoaderModule;
  pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

  const runtime = pyodide as PyodideRuntime;
  // The user-code path redirects sys.stdout / sys.stderr into
  // `__lingua_stdout` / `__lingua_stderr` (see the `execute` block
  // below) and reads them back via `runPythonAsync`. These
  // `setStdout` / `setStderr` callbacks therefore only fire for
  // Pyodide host-level chatter that arrives outside that redirect
  // — typically during the one-time `loadPyodide` boot. We still
  // gate on `activeRunId` so that a stray late-flushed chunk
  // arriving between runs is dropped here instead of being tagged
  // with the wrong run's id.
  runtime.setStdout?.({
    batched: (text: string) => {
      if (text.length > 0 && activeRunId) {
        ctx.postMessage({
          type: 'console',
          runId: activeRunId,
          method: 'log',
          args: [text],
        });
      }
    },
  });
  runtime.setStderr?.({
    batched: (text: string) => {
      if (text.length > 0 && activeRunId) {
        ctx.postMessage({
          type: 'console',
          runId: activeRunId,
          method: 'error',
          args: [text],
        });
      }
    },
  });

  return pyodide;
}

/** Parse Python traceback to extract line/column */
function parsePythonError(errorText: string): { line?: number; message: string } {
  // Look for "File "<exec>", line N" pattern
  const lineMatch = errorText.match(/File\s+"<exec>",\s+line\s+(\d+)/);
  // Get the last line as the actual error message
  const lines = errorText.trim().split('\n');
  const message = lines.at(-1) || errorText;
  const lineValue = lineMatch?.[1];

  return {
    line: lineValue ? parseInt(lineValue, 10) : undefined,
    message,
  };
}

function postBufferedOutput(
  runId: string,
  method: 'log' | 'error',
  text: string
): void {
  for (const line of text.split('\n').filter((entry) => entry.trim() !== '')) {
    ctx.postMessage({ type: 'console', runId, method, args: [line] });
  }
}

ctx.addEventListener('message', async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      ctx.postMessage({ type: 'loading', stage: 'Loading Python runtime...' });
      await loadPyodide();
      ctx.postMessage({ type: 'ready' });
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        error: {
          message: `Failed to load Pyodide: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
    return;
  }

  if (msg.type === 'execute') {
    const { runId, code, userEnv, resultTruncationMarker } = msg as {
      runId: string;
      code: string;
      userEnv?: Record<string, string>;
      resultTruncationMarker?: string;
    };
    const marker =
      typeof resultTruncationMarker === 'string' && resultTruncationMarker.length > 0
        ? resultTruncationMarker
        : FALLBACK_RESULT_TRUNCATION_MARKER;
    const startTime = performance.now();
    activeRunId = runId;

    try {
      const py = (await loadPyodide()) as PyodideRuntime;

      // RL-011 Slice D third increment — bridge user-space env into
      // Pyodide's os.environ so user code can call os.getenv(...) just
      // like the Go and Rust subprocess paths. Because this worker is
      // persistent, we must also remove keys that disappeared between
      // runs; otherwise stale values would linger in os.environ after
      // the user clears or renames a var.
      appliedUserEnvKeys = await syncUserEnvInPyodide(
        py,
        userEnv,
        appliedUserEnvKeys
      );

      await py.runPythonAsync(`
import io
import sys
import json as __lingua_json
__lingua_stdout = io.StringIO()
__lingua_stderr = io.StringIO()
__lingua_prev_stdout = sys.stdout
__lingua_prev_stderr = sys.stderr
sys.stdout = __lingua_stdout
sys.stderr = __lingua_stderr

__lingua_magic_results = []
def __mc(line, expr_fn):
    try:
        val = expr_fn()
        __lingua_magic_results.append({"line": line, "value": repr(val)})
        return val
    except Exception as e:
        __lingua_magic_results.append({"line": line, "value": str(e)})
        return None
      `);

      // RL-078: deadline enforcement is parent-owned. We just run.
      let result: unknown;
      let errorText: string | null = null;

      try {
        result = await py.runPythonAsync(code);
      } catch (err) {
        errorText = err instanceof Error ? err.message : String(err);
      }

      const streamState = await py.runPythonAsync(`
import sys
_lingua_state = __lingua_json.dumps({
    "stdout": __lingua_stdout.getvalue(),
    "stderr": __lingua_stderr.getvalue(),
    "magic": __lingua_magic_results,
})
sys.stdout = __lingua_prev_stdout
sys.stderr = __lingua_prev_stderr
__lingua_magic_results = []
_lingua_state
      `);

      const streams =
        typeof streamState === 'string'
          ? (JSON.parse(streamState) as { stdout: string; stderr: string; magic?: Array<{ line: number; value: string }> })
          : { stdout: '', stderr: '' };

      postBufferedOutput(runId, 'log', streams.stdout);
      postBufferedOutput(runId, 'error', streams.stderr);

      // Send magic comment results
      if (streams.magic) {
        for (const entry of streams.magic) {
          ctx.postMessage({
            type: 'magic-comment',
            runId,
            line: entry.line,
            value: truncate(entry.value, marker),
          });
        }
      }

      // Send result if non-None
      if (result !== undefined && result !== null) {
        const resultStr = typeof result === 'object' && result && 'toString' in result
          ? (result as { toString(): string }).toString()
          : String(result);
        if (resultStr !== 'None') {
          ctx.postMessage({
            type: 'result',
            runId,
            value: truncate(resultStr, marker),
          });
        }
      }

      if (errorText) {
        const parsed = parsePythonError(streams.stderr || errorText);
        ctx.postMessage({
          type: 'error',
          runId,
          error: {
            message: parsed.message,
            line: parsed.line,
          },
        });
      }

      ctx.postMessage({
        type: 'done',
        runId,
        executionTime: performance.now() - startTime,
      });
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      const parsed = parsePythonError(errorText);

      ctx.postMessage({
        type: 'error',
        runId,
        error: {
          message: parsed.message,
          line: parsed.line,
        },
      });

      ctx.postMessage({
        type: 'done',
        runId,
        executionTime: performance.now() - startTime,
      });
    } finally {
      activeRunId = null;
    }
  }
});
