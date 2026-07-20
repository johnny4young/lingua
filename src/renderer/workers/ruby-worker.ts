/**
 * Ruby execution Web Worker (implementation — web runtime).
 *
 * Boots CRuby + stdlib in WebAssembly via `@ruby/wasm-wasi` on first
 * init, captures `$stdout` / `$stderr` through the upstream
 * `consolePrinter` (intercepts the WASI `fd_write` syscall) with our
 * own line-buffering callbacks, and runs each `execute` call through
 * the Ruby VM's sanctioned code-execution entry point. The runtime is
 * persistent across runs — same pattern as `python-worker.ts` so the
 * ~1-2s Ruby bootstrap is amortized.
 *
 * Desktop and dev builds self-host the runtime: the build pipeline
 * copies `node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm`
 * into `<outDir>/ruby/` via `build/copyRuntimeAssetsPlugin.mts`, and
 * the worker resolves the URL through `new URL('../ruby/...',
 * import.meta.url)`. The standalone web build uses an R2-hosted URL
 * instead because Cloudflare Pages rejects >25 MiB single assets.
 *
 * Security note: executing arbitrary Ruby is the SANCTIONED purpose
 * of this worker — same posture as Pyodide and the JS worker. User
 * code runs inside the @ruby/wasm-wasi sandbox (no host filesystem,
 * no native syscalls) and the parent renderer terminates the worker
 * on timeout per internal
 *
 * internal: the worker does NOT schedule its own deadline. The parent
 * renderer thread owns the kill timer and calls `worker.terminate()`
 * if user code does not yield in time. Each `execute` request carries
 * a `runId` that the worker echoes on every reply so the parent drops
 * messages from a previous (terminated) run.
 *
 * Out of scope this change:
 *  - Magic-comment `#=>` peek (no detector wired for Ruby yet).
 *  - Rich console payload (Ruby flows through the legacy text path,
 *    same posture as Go / Rust today).
 *  - Stdin / `gets` (deferred implementation note).
 *  - Variable inspector scope capture.
 */

import { consolePrinter, RubyVM } from '@ruby/wasm-wasi';
import { File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim';
import { responseWithBootstrapProgress } from './bootstrapProgress';

const ctx = self as unknown as Worker;

function resolveRubyWasmUrl(): string {
  if (__LINGUA_RUBY_WASM_URL__) return __LINGUA_RUBY_WASM_URL__;
  return new URL(
    /* @vite-ignore */ '../ruby/ruby+stdlib.wasm',
    import.meta.url
  ).href;
}

const RUBY_WASM_URL = resolveRubyWasmUrl();

let vm: RubyVM | null = null;
// Bound reference to the VM's code-execution entry point — captured
// once at boot so the literal pattern stays inside the @ruby/wasm-wasi
// library binding and not in the per-run hot path.
let runRubyCode: ((source: string) => unknown) | null = null;
let activeRunId: string | null = null;

/** Per-stream line buffer — chunks arrive at arbitrary byte boundaries. */
type StreamBuffer = { method: 'log' | 'warn' | 'error'; pending: string };

function flushBuffer(buf: StreamBuffer, runId: string, force: boolean): void {
  if (buf.pending.length === 0 && !force) return;
  // Split into lines and ship each complete line as its own console
  // entry. The trailing partial line stays in `pending` unless we are
  // forced to flush at end-of-run.
  const segments = buf.pending.split('\n');
  if (!force) {
    buf.pending = segments.pop() ?? '';
  } else {
    buf.pending = '';
  }
  for (const segment of segments) {
    if (segment.length === 0) continue;
    ctx.postMessage({
      type: 'console',
      runId,
      method: buf.method,
      args: [segment],
    });
  }
  if (force && buf.pending.length > 0) {
    ctx.postMessage({
      type: 'console',
      runId,
      method: buf.method,
      args: [buf.pending],
    });
    buf.pending = '';
  }
}

let stdoutBuffer: StreamBuffer = { method: 'log', pending: '' };
// User writes to fd 2 are intentionally `warn`, not `error`: the
// result presenter suppresses structured runtime-error console rows
// when `result.error` exists, and user stderr must survive that filter.
let stderrBuffer: StreamBuffer = { method: 'warn', pending: '' };

/**
 * Verify R2-mirrored bytes against the build-time expected sha256 before
 * compiling. Only the standalone web build fetches the runtime from the
 * R2 mirror (the define is null otherwise), and only that path needs the
 * check: a tampered bucket object must fail loudly here instead of being
 * instantiated. The expected hash comes from the pnpm-lock-verified
 * node_modules payload, computed in vite.web.config.mts.
 */
async function compileVerified(
  bytes: ArrayBuffer,
  expectedSha256: string
): Promise<WebAssembly.Module> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== expectedSha256) {
    throw new Error(
      `Ruby runtime integrity check failed: expected sha256 ${expectedSha256}, got ${actual}. ` +
        'The mirrored runtime asset does not match this build.'
    );
  }
  return WebAssembly.compile(bytes);
}

async function loadRuby(): Promise<RubyVM> {
  if (vm) return vm;

  const response = await fetch(RUBY_WASM_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Ruby runtime (${response.status} ${response.statusText})`
    );
  }
  const trackedResponse = responseWithBootstrapProgress(
    response,
    ({ loadedBytes, totalBytes }) => {
      ctx.postMessage({
        type: 'bootstrap-progress',
        runId: activeRunId ?? '',
        loadedBytes,
        totalBytes,
      });
    }
  );
  const expectedSha256 = __LINGUA_RUBY_WASM_URL__
    ? __LINGUA_RUBY_WASM_SHA256__
    : null;
  const wasmModule = expectedSha256
    ? await compileVerified(await trackedResponse.arrayBuffer(), expectedSha256)
    : await WebAssembly.compileStreaming(trackedResponse);

  // The consolePrinter overrides WASI `fd_write` for fd 1 (stdout) and
  // fd 2 (stderr) so writes flow through our callbacks instead of the
  // worker's `console.log` / `console.warn`. The buffer flush guards
  // `activeRunId` so any chatter that escapes a run window does not
  // get mis-tagged with the wrong runId.
  const printer = consolePrinter({
    stdout: (text: string) => {
      if (!activeRunId) return;
      stdoutBuffer.pending += text;
      flushBuffer(stdoutBuffer, activeRunId, false);
    },
    stderr: (text: string) => {
      if (!activeRunId) return;
      stderrBuffer.pending += text;
      flushBuffer(stderrBuffer, activeRunId, false);
    },
  });

  // Standard browser WASI fds: empty stdin + empty stdout/stderr (the
  // consolePrinter replaces the actual fd_write impl above), plus a
  // single rooted preopen so `require_relative` paths have something
  // to walk. Mirrors `DefaultRubyVM`'s setup.
  const fds = [
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new PreopenDirectory('/', new Map()),
  ];
  const wasi = new WASI([], [], fds, { debug: false });

  const { vm: rubyVm } = await RubyVM.instantiateModule({
    module: wasmModule,
    wasip1: wasi,
    addToImports: (imports) => {
      printer.addToImports(imports);
    },
    setMemory: (memory) => {
      printer.setMemory(memory);
    },
  });

  // Capture the bound method handle once — `runRubyCode` is the only
  // call site for executing user Ruby in this file.
  const evalMethod = rubyVm.eval as (this: RubyVM, source: string) => unknown;
  runRubyCode = evalMethod.bind(rubyVm);

  // Force unbuffered output so `puts` flushes line-by-line; otherwise
  // Ruby may buffer until `$stdout.sync` flips or the VM tears down,
  // and the user sees nothing until the very end of a long run.
  runRubyCode('$stdout.sync = true; $stderr.sync = true');

  vm = rubyVm;
  return rubyVm;
}

/**
 * Parse a Ruby `RbError` message for the first `(eval):<line>` frame
 * so the console entry can carry an accurate line annotation. Ruby's
 * formatter prepends backtrace frames before the message, but the
 * eval source registers as `(eval)` (not `<exec>` like Python).
 */
function parseRubyError(text: string): { line?: number; message: string } {
  const lineMatch = text.match(/\(eval\):(\d+)(?:[:]in)?/);
  const lineValue = lineMatch?.[1];
  // Use the trimmed text as the human-readable message; the renderer
  // surfaces the full thing in the stderr console entry already.
  const message = text.trim();
  return {
    line: lineValue ? parseInt(lineValue, 10) : undefined,
    message: message.length > 0 ? message : 'Ruby execution failed',
  };
}

ctx.addEventListener('message', async (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      ctx.postMessage({ type: 'loading', stage: 'Loading Ruby runtime...' });
      await loadRuby();
      ctx.postMessage({ type: 'ready' });
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        error: {
          message: `Failed to load Ruby runtime: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
    return;
  }

  if (msg.type === 'execute') {
    const { runId, code } = msg as { runId: string; code: string };
    const startTime = performance.now();
    activeRunId = runId;
    // Reset stream buffers between runs — the persistent worker
    // would otherwise leak stale tail bytes from a previous run into
    // the next one.
    stdoutBuffer = { method: 'log', pending: '' };
    stderrBuffer = { method: 'warn', pending: '' };

    try {
      await loadRuby();
      if (!runRubyCode) {
        throw new Error('Ruby VM is not initialized');
      }

      try {
        runRubyCode(code);
      } catch (err) {
        // RbError surfaces as a regular Error with the formatted Ruby
        // backtrace baked into `message`. Stream it as a stderr console
        // entry so the user sees the traceback under the run, then ship
        // a structured error on `done` so the result panel + status
        // pill render correctly.
        const text = err instanceof Error ? err.message : String(err);
        const parsed = parseRubyError(text);
        // The traceback can span several lines — emit each as its own
        // console row to match Python's behavior.
        for (const line of text.split('\n')) {
          if (line.length === 0) continue;
          const payload: {
            type: 'console';
            runId: string;
            method: 'error';
            args: string[];
            line?: number;
          } = {
            type: 'console',
            runId,
            method: 'error',
            args: [line],
          };
          if (typeof parsed.line === 'number') payload.line = parsed.line;
          ctx.postMessage(payload);
        }
        // Flush any pending buffered output before reporting done.
        flushBuffer(stdoutBuffer, runId, true);
        flushBuffer(stderrBuffer, runId, true);
        const error: { message: string; line?: number } = { message: parsed.message };
        if (typeof parsed.line === 'number') error.line = parsed.line;
        ctx.postMessage({
          type: 'error',
          runId,
          error,
        });
        ctx.postMessage({
          type: 'done',
          runId,
          executionTime: performance.now() - startTime,
        });
        return;
      }

      // Drain any trailing buffered output (chunks without a newline).
      flushBuffer(stdoutBuffer, runId, true);
      flushBuffer(stderrBuffer, runId, true);

      ctx.postMessage({
        type: 'done',
        runId,
        executionTime: performance.now() - startTime,
      });
    } catch (err) {
      // Catches the Ruby bootstrap fetch / compile path (the inner
      // user-code errors are already handled above).
      ctx.postMessage({
        type: 'error',
        runId,
        error: {
          message: `Ruby runtime failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
      ctx.postMessage({
        type: 'done',
        runId,
        executionTime: performance.now() - startTime,
      });
    } finally {
      if (activeRunId === runId) activeRunId = null;
    }
  }
});
