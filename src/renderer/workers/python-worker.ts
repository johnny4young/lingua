/**
 * Python execution Web Worker using Pyodide (CPython compiled to WASM).
 *
 * Loads Pyodide from CDN on first use, caches in memory for subsequent runs.
 * Captures stdout/stderr and sends to main thread.
 */

// Make this file a module so TS doesn't merge its scope with other workers
export {};

// Worker global function (not available in DOM lib)
declare function importScripts(...urls: string[]): void;

const ctx = self as unknown as Worker;

// Pyodide CDN URL
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

let pyodide: unknown = null;

async function loadPyodide(): Promise<unknown> {
  if (pyodide) return pyodide;

  // Import Pyodide from CDN
  importScripts(`${PYODIDE_CDN}pyodide.js`);

  // @ts-expect-error loadPyodide is globally available after importScripts
  pyodide = await self.loadPyodide({
    indexURL: PYODIDE_CDN,
    stdout: (text: string) => {
      if (text.length > 0) {
        ctx.postMessage({ type: 'console', method: 'log', args: [text] });
      }
    },
    stderr: (text: string) => {
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
      const py = await loadPyodide();

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
      // @ts-expect-error pyodide API
      const result = await py.runPythonAsync(code);

      clearTimeout(timeoutId);
      if (timedOut) return;

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
