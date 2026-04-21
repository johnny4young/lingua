/**
 * Python execution Web Worker using Pyodide (CPython compiled to WASM).
 *
 * Loads Pyodide from CDN on first use, caches in memory for subsequent runs.
 * Captures stdout/stderr and sends to main thread.
 */

// Worker global function (not available in DOM lib)
declare function importScripts(...urls: string[]): void;

import { syncUserEnvInPyodide } from './python-worker-env';

const ctx = self as unknown as Worker;

// Pyodide CDN URL
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

let pyodide: unknown = null;
let appliedUserEnvKeys: string[] = [];

type PyodideRuntime = {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout?: (options: { batched: (text: string) => void }) => void;
  setStderr?: (options: { batched: (text: string) => void }) => void;
  globals: {
    set(name: string, value: unknown): void;
    delete?(name: string): void;
  };
};

async function loadPyodide(): Promise<unknown> {
  if (pyodide) return pyodide;

  // Import Pyodide from CDN
  importScripts(`${PYODIDE_CDN}pyodide.js`);

  // @ts-expect-error loadPyodide is globally available after importScripts
  pyodide = await self.loadPyodide({ indexURL: PYODIDE_CDN });

  const runtime = pyodide as PyodideRuntime;
  runtime.setStdout?.({
    batched: (text: string) => {
      if (text.length > 0) {
        ctx.postMessage({ type: 'console', method: 'log', args: [text] });
      }
    },
  });
  runtime.setStderr?.({
    batched: (text: string) => {
      if (text.length > 0) {
        ctx.postMessage({ type: 'console', method: 'error', args: [text] });
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

function postBufferedOutput(method: 'log' | 'error', text: string): void {
  for (const line of text.split('\n').filter((entry) => entry.trim() !== '')) {
    ctx.postMessage({ type: 'console', method, args: [line] });
  }
}

ctx.addEventListener('message', async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      ctx.postMessage({ type: 'loading', stage: 'Downloading Pyodide runtime...' });
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
    const { code, timeout, userEnv } = msg as {
      code: string;
      timeout: number;
      userEnv?: Record<string, string>;
    };
    const startTime = performance.now();

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

      // Set up timeout
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        ctx.postMessage({
          type: 'error',
          error: { message: `Execution timed out after ${timeout / 1000}s` },
        });
        ctx.postMessage({
          type: 'done',
          executionTime: performance.now() - startTime,
        });
      }, timeout);

      // Run the Python code
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

      clearTimeout(timeoutId);
      if (timedOut) return;

      postBufferedOutput('log', streams.stdout);
      postBufferedOutput('error', streams.stderr);

      // Send magic comment results
      if (streams.magic) {
        for (const entry of streams.magic) {
          ctx.postMessage({
            type: 'magic-comment',
            line: entry.line,
            value: entry.value,
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
            value: resultStr,
          });
        }
      }

      if (errorText) {
        const parsed = parsePythonError(streams.stderr || errorText);
        ctx.postMessage({
          type: 'error',
          error: {
            message: parsed.message,
            line: parsed.line,
          },
        });
      }

      ctx.postMessage({
        type: 'done',
        executionTime: performance.now() - startTime,
      });
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      const parsed = parsePythonError(errorText);

      ctx.postMessage({
        type: 'error',
        error: {
          message: parsed.message,
          line: parsed.line,
        },
      });

      ctx.postMessage({
        type: 'done',
        executionTime: performance.now() - startTime,
      });
    }
  }
});
