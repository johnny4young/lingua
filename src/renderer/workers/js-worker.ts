/**
 * JavaScript execution Web Worker.
 *
 * Runs user code in an isolated context with console capture.
 * Communication via structured messages (JsWorkerInboundMessage in /
 * WorkerResponse out — see internal note above WorkerInboundMessage).
 *
 * internal: this worker no longer schedules its own deadline. The
 * parent renderer thread owns a kill timer and calls
 * `worker.terminate()` if user code does not yield in time. The
 * `runId` from each `execute` request is echoed on every reply so
 * the parent can drop messages from a previous (terminated) run.
 *
 * implementation: when the renderer instrumented the source, the
 * `execute` payload carries `{ debug: true, breakpoints, ... }`. The
 * worker injects two closure helpers — `__lingua_dbg_yield(line, getLocals)`
 * called before each statement, and `__lingua_dbg_frame(name, line)` /
 * `__lingua_dbg_pop()` for frame-depth tracking that powers step-over
 * / step-into / step-out. Pauses fire only when the breakpoint set
 * contains the current line OR the current step mode dictates a stop;
 * otherwise the yield function fast-paths to `Promise.resolve()`.
 *
 * Reference: implementation and `docs/DEBUGGER_ADR.md`.
 *
 * internal: trust boundary for the `new AsyncFunction(...)`
 * eval in `js-worker-execution.ts`. The renderer/main thread is already
 * trusted and hands us the user's own source verbatim — no remote or adversarial input
 * reaches this surface, so this is NOT a sandbox for hostile code.
 * The Web Worker isolation exists to bound the blast radius of
 * runtime faults (unhandled exceptions, infinite loops, runaway
 * memory) so the renderer can `worker.terminate()` and recover,
 * not to defend against an attacker who controls `code`. Note that
 * the Node-only symbols `process` and `require` are absent here by
 * the Web Worker global contract: this file runs in a DOM-less
 * worker scope, so reading `globalThis.process` / `globalThis.require`
 * returns `undefined` and the worker cannot escalate into Node.
 * `tests/workers/js-worker-helpers.test.ts` locks that invariant.
 * If a future bundler/runtime change ever leaks either symbol into
 * the worker scope, that is a security-boundary regression — treat
 * it as such and do not paper over it.
 */

// Make this file a module so TS doesn't merge its scope with other workers
export {};

import { createJsWorkerMessageHandler } from './js-worker-execution';

const ctx = self as unknown as Worker;
ctx.addEventListener('message', createJsWorkerMessageHandler(ctx));
