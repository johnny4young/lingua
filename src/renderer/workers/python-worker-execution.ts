import { syncUserEnvInPyodide } from './python-worker-env';
import { createStdinLineReader } from './python-worker-stdin';
import { finalizeScopeSnapshot } from '../../shared/scopeSnapshot';
import { parsePythonTraceback } from '../../shared/errorStack';
import type { RichOutputPayload } from '../../shared/richOutput';
import type { PythonWorkerExecutionMessage, PythonWorkerPort } from './python-worker-protocol';
import type { PythonRuntimeAdapter } from './python-worker-runtime';
import {
  PYTHON_WORKER_FALLBACK_RESULT_TRUNCATION_MARKER,
  buildPythonRichMediaBridge,
  capturePythonScope,
  parsePythonWorkerError,
  postPythonBufferedOutput,
  postPythonPrintEntries,
  primePythonBootGlobalsIfNeeded,
  truncatePythonWorkerValue,
  type PythonPrintEntry,
} from './python-worker-serialization';
import {
  buildPythonExecutionBootstrapSource,
  PYTHON_STREAM_STATE_SOURCE,
} from './python-worker-sources';

export function createPythonExecutionHandler(ctx: PythonWorkerPort, runtime: PythonRuntimeAdapter) {
  let appliedUserEnvKeys: string[] = [];
  const scopeNamespaces = new Map<string, { destroy?: () => void }>();

  return async (msg: PythonWorkerExecutionMessage): Promise<void> => {
    if (msg.type === 'reset-scope') {
      // implementation — Restart kernel / tab close: drop a notebook's persistent scope
      // dict so the next run starts clean. Idempotent for an unknown scopeId.
      const { scopeId } = msg;
      if (typeof scopeId === 'string' && scopeId.length > 0) {
        const ns = scopeNamespaces.get(scopeId);
        if (ns && typeof ns.destroy === 'function') {
          try {
            ns.destroy();
          } catch {
            /* proxy already finalized */
          }
        }
        scopeNamespaces.delete(scopeId);
      }
      return;
    }

    if (msg.type === 'init') {
      try {
        ctx.postMessage({ type: 'loading', stage: 'Loading Python runtime...' });
        await runtime.loadPyodide();
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
      const {
        runId,
        code,
        userEnv,
        resultTruncationMarker,
        stdin,
        captureScope,
        scopeDepth,
        scopeId,
      } = msg;
      const marker =
        typeof resultTruncationMarker === 'string' && resultTruncationMarker.length > 0
          ? resultTruncationMarker
          : PYTHON_WORKER_FALLBACK_RESULT_TRUNCATION_MARKER;
      const startTime = performance.now();
      runtime.setActiveRunId(runId);

      // implementation — line-by-line stdin reader (see
      // python-worker-stdin.ts for the EOF / empty-buffer contract).
      const stdinReader = createStdinLineReader(stdin);
      const stdinTotal = stdinReader.total;

      try {
        const py = await runtime.loadPyodide();

        // implementation — install the stdin handler for EVERY run, not
        // only when the panel has lines. With an empty buffer the reader
        // returns `null` on the first read, so a bare `input()` raises a
        // clean `EOFError` — the documented panel behavior. Falling back
        // to Pyodide's STOCK handler instead would try `prompt()`, which
        // does not exist in a Worker: Pyodide logs a raw
        // `ReferenceError: prompt is not defined` to the renderer console
        // on every read and surfaces an OSError instead of EOFError
        // (caught live in the 2026-06-10 desktop validation).
        if (typeof py.setStdin === 'function') {
          py.setStdin({
            stdin: () => stdinReader.read(),
            isatty: false,
          });
        }

        // implementation third increment — bridge user-space env into
        // Pyodide's os.environ so user code can call os.getenv(...) just
        // like the Go and Rust subprocess paths. Because this worker is
        // persistent, we must also remove keys that disappeared between
        // runs; otherwise stale values would linger in os.environ after
        // the user clears or renames a var.
        appliedUserEnvKeys = await syncUserEnvInPyodide(py, userEnv, appliedUserEnvKeys);

        // implementation — install the JS-backed rich-media
        // callbacks BEFORE the Python preamble runs so the `__lingua`
        // namespace can reference them. The bridge is captured per-run
        // (`runId`-bound) so a stale reply from a killed run cannot
        // tag the next run's output. Pyodide's `globals.set` is
        // re-entrant; the previous run's binding is overwritten in place
        // without leaking.
        const richMediaBridge = buildPythonRichMediaBridge(runId);
        py.globals.set('__lingua_emit_chart', richMediaBridge.chart);
        py.globals.set('__lingua_emit_image', richMediaBridge.image);
        py.globals.set('__lingua_emit_html', richMediaBridge.html);

        await py.runPythonAsync(buildPythonExecutionBootstrapSource(msg));

        if (captureScope === true) {
          await primePythonBootGlobalsIfNeeded(py);
        }

        // internal: deadline enforcement is parent-owned. We just run.
        let result: unknown;
        let errorText: string | null = null;

        try {
          if (typeof scopeId === 'string' && scopeId.length > 0) {
            // implementation — run user code against the notebook's persistent scope
            // dict. Seed it with the framework helpers (refreshed each run),
            // then execute with `globals: ns` so assignments land in — and
            // reads resolve from — the per-notebook namespace.
            let ns = scopeNamespaces.get(scopeId);
            if (ns === undefined && typeof py.runPython === 'function') {
              ns = py.runPython('dict()') as { destroy?: () => void };
              scopeNamespaces.set(scopeId, ns);
            }
            const seed = py.globals.get?.('__lingua_seed_scope') as
              | ((namespace: unknown) => void)
              | undefined;
            if (seed && ns !== undefined) {
              try {
                seed(ns);
              } finally {
                (seed as unknown as { destroy?: () => void }).destroy?.();
              }
            }
            // Only pass `globals` when a real dict proxy exists. If `runPython`
            // was unavailable (an odd build / a mock), `ns` is undefined —
            // passing `{ globals: undefined }` would either throw or silently
            // fall back to the module globals; run the legacy unscoped path
            // explicitly instead so the call never sees an undefined globals.
            result =
              ns !== undefined
                ? await py.runPythonAsync(code, { globals: ns })
                : await py.runPythonAsync(code);
          } else {
            result = await py.runPythonAsync(code);
          }
        } catch (err) {
          errorText = err instanceof Error ? err.message : String(err);
        }

        const streamState = await py.runPythonAsync(PYTHON_STREAM_STATE_SOURCE);

        const streams =
          typeof streamState === 'string'
            ? (JSON.parse(streamState) as {
                stdout: string;
                stderr: string;
                magic?: Array<{ line: number; value: string; payload?: RichOutputPayload }>;
                print_entries?: PythonPrintEntry[];
              })
            : { stdout: '', stderr: '' };

        // implementation — when the Python preamble produced typed
        // print entries (the common case once the override is in place),
        // post those instead of splitting the buffered stdout. The
        // buffered text path remains the fallback when print_entries is
        // empty (e.g. the user opted out via Settings, or stdout was
        // written via sys.stdout.write directly bypassing the override).
        const printEntries = Array.isArray(streams.print_entries) ? streams.print_entries : [];
        if (printEntries.length > 0) {
          postPythonPrintEntries(runId, printEntries);
        } else {
          postPythonBufferedOutput(runId, 'log', streams.stdout);
        }
        postPythonBufferedOutput(runId, 'error', streams.stderr);

        // Send magic comment results
        if (streams.magic) {
          for (const entry of streams.magic) {
            // implementation note — `#=> table` directive surfaces a
            // forced-table payload alongside the legacy `value` text.
            // Renderers that don't consume the payload still see the
            // text fallback unchanged.
            const magicMessage: {
              type: 'magic-comment';
              runId: string;
              line: number;
              value: string;
              payload?: RichOutputPayload;
            } = {
              type: 'magic-comment',
              runId,
              line: entry.line,
              value: truncatePythonWorkerValue(entry.value, marker),
            };
            if (entry.payload) magicMessage.payload = entry.payload;
            ctx.postMessage(magicMessage);
          }
        }

        // Send result if non-None
        if (result !== undefined && result !== null) {
          const resultStr =
            typeof result === 'object' && result && 'toString' in result
              ? (result as { toString(): string }).toString()
              : String(result);
          if (resultStr !== 'None') {
            ctx.postMessage({
              type: 'result',
              runId,
              value: truncatePythonWorkerValue(resultStr, marker),
            });
          }
        }

        if (errorText) {
          const parsed = parsePythonWorkerError(streams.stderr || errorText);
          const tracebackText = streams.stderr || errorText;
          // implementation — structured stack frames for the
          // renderer's clickable-stack surface. Best-effort parse;
          // unparseable lines stay as text-only frames so they render
          // as non-clickable spans.
          const frames = parsePythonTraceback(tracebackText);
          ctx.postMessage({
            type: 'error',
            runId,
            error: {
              message: parsed.message,
              line: parsed.line,
              stack: tracebackText,
              ...(frames.length > 0 ? { frames } : {}),
            },
          });
        }

        // implementation — capture the post-execute globals BEFORE
        // the stdin-consumed / done replies. Runs only when the runner
        // asked (`captureScope === true`); the runner asks when the
        // inspector toggle is on for the active tab OR when the user
        // wants the toggle to light up after the next run. The first
        // capture primes `pythonBootGlobals` so subsequent runs can
        // subtract the boot-time set.
        if (captureScope === true && !errorText) {
          try {
            const snapshot = await capturePythonScope(py, scopeDepth);
            ctx.postMessage({ type: 'scope-snapshot', runId, snapshot });
          } catch (captureErr) {
            ctx.postMessage({
              type: 'scope-snapshot',
              runId,
              snapshot: finalizeScopeSnapshot('python', []),
              error: captureErr instanceof Error ? captureErr.message : String(captureErr),
            });
          }
        }

        // implementation note — emit consumption summary BEFORE
        // `done` so the runner can stitch it onto `ExecutionResult`.
        if (stdinTotal > 0) {
          ctx.postMessage({
            type: 'stdin-consumed',
            runId,
            count: stdinReader.consumedCount(),
            total: stdinTotal,
          });
        }

        ctx.postMessage({
          type: 'done',
          runId,
          executionTime: performance.now() - startTime,
        });
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        const parsed = parsePythonWorkerError(errorText);
        // implementation — implementation parity. The inner-streams
        // error path (above) already parses Pyodide's stderr traceback;
        // this outer-catch fires when Pyodide itself throws BEFORE the
        // user code's traceback reaches stderr (SyntaxError on compile,
        // import-time failures, etc.). Pyodide formats the Python
        // traceback into `err.message`, so the same parser produces the
        // same structured frames here. Omitting `frames` would have
        // produced a silently text-only error for these paths.
        const frames = parsePythonTraceback(errorText);

        ctx.postMessage({
          type: 'error',
          runId,
          error: {
            message: parsed.message,
            line: parsed.line,
            stack: errorText,
            ...(frames.length > 0 ? { frames } : {}),
          },
        });

        if (stdinTotal > 0) {
          ctx.postMessage({
            type: 'stdin-consumed',
            runId,
            count: stdinReader.consumedCount(),
            total: stdinTotal,
          });
        }

        ctx.postMessage({
          type: 'done',
          runId,
          executionTime: performance.now() - startTime,
        });
      } finally {
        runtime.setActiveRunId(null);
        // implementation — restore Pyodide's stock stdin handler so
        // the next run starts on a clean baseline (the worker is
        // persistent unlike js-worker.ts). Reset unconditionally: the
        // line reader above is now installed on every run.
        runtime.resetStdin();
      }
      return;
    }

    const unhandled: never = msg;
    void unhandled;
  };
}
