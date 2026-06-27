/**
 * RL-027 Slice 1 — runtime-agnostic bridge between the UI and the
 * worker that owns the paused execution. The JS / TS runners register
 * the active Worker via `setActiveDebugWorker(worker)` when a debug
 * run starts and clear it on `done`. The DebuggerDrawer's continue /
 * step buttons call `postDebuggerMessage(...)` which forwards the
 * message to the registered worker.
 *
 * This indirection keeps the runner classes from leaking out of the
 * runtime/ folder into UI code, and keeps the door open for the
 * Slice 2+ Python / Go / Rust adapters to plug in (each language's
 * adapter implements this same `(type, payload) => void` shape).
 *
 * Reference: RL-027 Slice 1 and docs/DEBUGGER_ADR.md.
 */

type DebuggerControlMessage =
  | { type: 'resume' }
  | { type: 'step'; mode: 'over' | 'into' | 'out' }
  | { type: 'set-breakpoints'; breakpoints: { line: number; condition?: string }[] };

type Poster = (msg: DebuggerControlMessage) => void;

const ref: { poster: Poster | null } = { poster: null };

export function setActiveDebugWorker(worker: Worker | null): void {
  ref.poster = worker
    ? (msg) => {
        try {
          worker.postMessage(msg);
        } catch {
          /* silent — worker may already be terminated */
        }
      }
    : null;
}

export function postDebuggerMessage(msg: DebuggerControlMessage): boolean {
  if (!ref.poster) return false;
  ref.poster(msg);
  return true;
}

export function isDebugWorkerActive(): boolean {
  return ref.poster !== null;
}
