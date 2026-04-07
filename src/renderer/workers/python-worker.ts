/**
 * Python execution Web Worker using Pyodide (CPython compiled to WASM).
 *
 * Loads Pyodide from CDN on first use, caches in memory for subsequent runs.
 * Captures stdout/stderr and sends to main thread.
 */

// Worker global function (not available in DOM lib)
declare function importScripts(...urls: string[]): void;

const ctx = self as unknown as Worker;

// Pyodide CDN URL
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

let pyodide: unknown = null;

type PyodideRuntime = {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout?: (options: { batched: (text: string) => void }) => void;
  setStderr?: (options: { batched: (text: string) => void }) => void;
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
  const message = lines[lines.length - 1] || errorText;

  return {
    line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
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
    const { code, timeout } = msg;
    const startTime = performance.now();

    try {
      const py = (await loadPyodide()) as PyodideRuntime;

      await py.runPythonAsync(`
import io
import sys
__runlang_stdout = io.StringIO()
__runlang_stderr = io.StringIO()
__runlang_prev_stdout = sys.stdout
__runlang_prev_stderr = sys.stderr
sys.stdout = __runlang_stdout
sys.stderr = __runlang_stderr
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
import json
import sys
_runlang_state = json.dumps({
    "stdout": __runlang_stdout.getvalue(),
    "stderr": __runlang_stderr.getvalue(),
})
sys.stdout = __runlang_prev_stdout
sys.stderr = __runlang_prev_stderr
_runlang_state
      `);

      const streams =
        typeof streamState === 'string'
          ? (JSON.parse(streamState) as { stdout: string; stderr: string })
          : { stdout: '', stderr: '' };

      clearTimeout(timeoutId);
      if (timedOut) return;

      postBufferedOutput('log', streams.stdout);
      postBufferedOutput('error', streams.stderr);

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
