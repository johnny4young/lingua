import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createMigrate } from './persistence/migrationRegistry';

/**
 * implementation — Debugger state machine store.
 *
 * # Purpose
 *
 * Source of truth for the active debug session, registered breakpoints
 * (per file), watch expressions (global), and the last call-stack frame
 * snapshot. The store is intentionally **runtime-agnostic** — implementation
 * implements only the JS adapter, but the shape carries a discriminated
 * `runtime` field so implementation (Python `pdb`), implementation (Go Delve), and
 * implementation (Rust lldb) can plug in without re-architecting.
 *
 * # Persistence
 *
 * Lives in a dedicated localStorage key `lingua-debugger-state` (Vite
 * config `envDir` precedent set by implementation so the persisted
 * blob never collides with `lingua-settings`). Persisted: `breakpoints`
 * + `watches`. NOT persisted: `session` (transient, dies on reload),
 * `pausedFrame` (only meaningful while paused).
 *
 * # Caps (implementation note)
 *
 * `MAX_BREAKPOINTS_GLOBAL = 100` with FIFO eviction of the
 * oldest-by-line breakpoint when the cap is hit. The cap is global
 * across all files so a misclick spam at the gutter cannot blow the
 * localStorage budget.
 *
 * # Concurrency
 *
 * The store is read both reactively (`useDebuggerStore(...)`) and
 * imperatively from event handlers (`useDebuggerStore.getState()`).
 * Every mutator returns a new state object so React subscribers
 * re-render correctly.
 *
 * Reference: implementation and `docs/DEBUGGER_ADR.md`.
 */

export const DEBUGGER_STORAGE_KEY = 'lingua-debugger-state';
export const MAX_BREAKPOINTS_GLOBAL = 100;
export const MAX_WATCHES = 20;

export type DebuggerRuntime = 'js' | 'python' | 'go' | 'rust';
export type PauseReason = 'user-breakpoint' | 'step' | 'exception';

export interface Breakpoint {
  /** Tab id (matches `tabsStore.activeTabId`) — uniquely identifies the file. */
  tabId: string;
  /** 1-indexed line number in the user's source (NOT the instrumented JS). */
  line: number;
  /**
   * Optional predicate (implementation note — conditional breakpoints). When set,
   * the worker evaluates the expression in the paused-frame closure
   * and only pauses if the result is truthy. Empty string === no
   * condition.
   */
  condition: string;
  /** Set to `false` to keep the gutter mark but skip the pause. */
  enabled: boolean;
}

export interface CallStackFrame {
  /**
   * Display name of the function, or `<anonymous>` for nameless
   * function expressions. The worker computes this from
   * `Function.prototype.name`.
   */
  functionName: string;
  /** 1-indexed source line where the frame's call-site lives. */
  line: number;
}

export interface PausedFrame {
  /** Tab the user paused in (selects the file gutter to highlight). */
  tabId: string;
  /** 1-indexed source line that triggered the pause. */
  line: number;
  /** Why the pause fired (per ADR §4 — feeds telemetry `reasonBucket`). */
  reason: PauseReason;
  /**
   * Locals + args at the paused frame, captured via the yield
   * closure thunk. Values are pre-serialized strings (worker can't
   * postMessage every JS value type — Functions, DOM nodes, etc.
   * stringify lossy here).
   */
  locals: Record<string, string>;
  /** Read-only call-stack snapshot, newest frame first. */
  callStack: CallStackFrame[];
  /**
   * Latest watch evaluations, keyed by the user-typed expression. Each
   * entry is `{ value, error }` (exactly one defined when evaluated)
   * OR `{ pending: true }` while implementation ships without the eval pass —
   * implementation introduces predicate evaluation under a security review.
   */
  watchResults: Record<string, { value?: string; error?: string; pending?: boolean }>;
}

export interface DebuggerSession {
  /** Which language adapter is attached. implementation only emits `'js'`. */
  runtime: DebuggerRuntime;
  /** Tab the session is bound to. */
  tabId: string;
  /** Wall-clock time the session attached, used for telemetry latency. */
  attachedAt: number;
}

export interface WatchExpression {
  /** Stable id for React keys + delete actions. */
  id: string;
  /** Raw user-typed expression — never trusted, always evaluated in
   * the paused closure (no eval if no pause). */
  expression: string;
}

export interface DebuggerState {
  /** All breakpoints, flat (cross-tab). Indexed by `${tabId}:${line}`. */
  breakpoints: Record<string, Breakpoint>;
  /** Order of insertion for FIFO eviction at the cap. */
  breakpointOrder: string[];
  /** Watch expressions — global; same set evaluates against every pause. */
  watches: WatchExpression[];

  // Session state — NOT persisted.
  session: DebuggerSession | null;
  pausedFrame: PausedFrame | null;
  /**
   * implementation note — drawer collapse state. Persists across reloads
   * (folded users want it folded when they reopen) but defaults to
   * expanded so first-time users discover the panel.
   */
  drawerCollapsed: boolean;

  // Mutators — breakpoints
  toggleBreakpoint: (tabId: string, line: number) => void;
  setBreakpointCondition: (tabId: string, line: number, condition: string) => void;
  setBreakpointEnabled: (tabId: string, line: number, enabled: boolean) => void;
  /**
   * implementation note — batch-update `enabled` on every breakpoint.
   * Used by the Debugger panel's Disable all / Enable all control: a
   * single mutator avoids tearing UI re-render across 100 individual calls.
   */
  setAllBreakpointsEnabled: (enabled: boolean) => void;
  clearAllBreakpoints: () => void;
  breakpointsForTab: (tabId: string) => Breakpoint[];

  // Mutators — session lifecycle
  attachSession: (session: DebuggerSession) => void;
  detachSession: () => void;
  setPausedFrame: (frame: PausedFrame | null) => void;

  // Mutators — watches
  addWatch: (expression: string) => void;
  removeWatch: (id: string) => void;
  updateWatchResults: (
    results: Record<string, { value?: string; error?: string; pending?: boolean }>
  ) => void;

  // Mutators — drawer collapse (implementation note).
  toggleDrawerCollapsed: () => void;
}

function bpKey(tabId: string, line: number): string {
  return `${tabId}:${line}`;
}

function isPositiveLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function sanitizeBreakpoints(
  value: unknown,
  rawOrder: unknown
): Pick<DebuggerState, 'breakpoints' | 'breakpointOrder'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { breakpoints: {}, breakpointOrder: [] };
  }

  const breakpoints: Record<string, Breakpoint> = {};
  for (const raw of Object.values(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const candidate = raw as Partial<Breakpoint>;
    if (typeof candidate.tabId !== 'string' || candidate.tabId.length === 0) continue;
    if (!isPositiveLine(candidate.line)) continue;
    const condition = typeof candidate.condition === 'string' ? candidate.condition : '';
    breakpoints[bpKey(candidate.tabId, candidate.line)] = {
      tabId: candidate.tabId,
      line: candidate.line,
      condition,
      enabled: candidate.enabled !== false,
    };
  }

  const order: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawOrder)) {
    for (const key of rawOrder) {
      if (typeof key !== 'string') continue;
      if (!breakpoints[key] || seen.has(key)) continue;
      order.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(breakpoints)) {
    if (seen.has(key)) continue;
    order.push(key);
    seen.add(key);
  }
  while (order.length > MAX_BREAKPOINTS_GLOBAL) {
    const oldest = order.shift();
    if (oldest) delete breakpoints[oldest];
  }

  return { breakpoints, breakpointOrder: order };
}

function sanitizeWatches(value: unknown): WatchExpression[] {
  if (!Array.isArray(value)) return [];
  const watches: WatchExpression[] = [];
  const seenExpressions = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const candidate = raw as Partial<WatchExpression>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue;
    if (typeof candidate.expression !== 'string') continue;
    const expression = candidate.expression.trim();
    if (!expression || seenExpressions.has(expression)) continue;
    watches.push({ id: candidate.id, expression });
    seenExpressions.add(expression);
    if (watches.length >= MAX_WATCHES) break;
  }
  return watches;
}

let monotonicWatchId = 0;
function nextWatchId(): string {
  monotonicWatchId += 1;
  return `watch-${Date.now()}-${monotonicWatchId}`;
}

export const useDebuggerStore = create<DebuggerState>()(
  persist(
    (set, get) => ({
      breakpoints: {},
      breakpointOrder: [],
      watches: [],
      session: null,
      pausedFrame: null,
      drawerCollapsed: false,

      toggleBreakpoint: (tabId, line) => {
        if (typeof tabId !== 'string' || tabId.length === 0 || !isPositiveLine(line)) {
          return;
        }
        set((state) => {
          const key = bpKey(tabId, line);
          if (state.breakpoints[key]) {
            // Remove
            const next = { ...state.breakpoints };
            delete next[key];
            return {
              breakpoints: next,
              breakpointOrder: state.breakpointOrder.filter((k) => k !== key),
            };
          }
          // Add — enforce the global cap with FIFO eviction.
          const breakpoints = { ...state.breakpoints };
          const order = [...state.breakpointOrder];
          while (order.length >= MAX_BREAKPOINTS_GLOBAL) {
            const oldest = order.shift();
            if (oldest) delete breakpoints[oldest];
          }
          breakpoints[key] = { tabId, line, condition: '', enabled: true };
          order.push(key);
          return { breakpoints, breakpointOrder: order };
        });
      },

      setBreakpointCondition: (tabId, line, condition) => {
        if (typeof tabId !== 'string' || tabId.length === 0 || !isPositiveLine(line)) {
          return;
        }
        set((state) => {
          const key = bpKey(tabId, line);
          const existing = state.breakpoints[key];
          if (!existing) return state;
          return {
            breakpoints: {
              ...state.breakpoints,
              [key]: { ...existing, condition },
            },
          };
        });
      },

      setBreakpointEnabled: (tabId, line, enabled) => {
        if (typeof tabId !== 'string' || tabId.length === 0 || !isPositiveLine(line)) {
          return;
        }
        set((state) => {
          const key = bpKey(tabId, line);
          const existing = state.breakpoints[key];
          if (!existing) return state;
          return {
            breakpoints: {
              ...state.breakpoints,
              [key]: { ...existing, enabled },
            },
          };
        });
      },

      clearAllBreakpoints: () => {
        set({ breakpoints: {}, breakpointOrder: [] });
      },

      setAllBreakpointsEnabled: (enabled) => {
        set((state) => {
          const next: Record<string, Breakpoint> = {};
          let changed = false;
          for (const [key, bp] of Object.entries(state.breakpoints)) {
            if (bp.enabled === enabled) {
              next[key] = bp;
              continue;
            }
            next[key] = { ...bp, enabled };
            changed = true;
          }
          if (!changed) return state;
          return { breakpoints: next };
        });
      },

      breakpointsForTab: (tabId) => {
        const all = get().breakpoints;
        const out: Breakpoint[] = [];
        for (const bp of Object.values(all)) {
          if (bp.tabId === tabId) out.push(bp);
        }
        return out;
      },

      attachSession: (session) => {
        set({ session, pausedFrame: null });
      },

      detachSession: () => {
        set({ session: null, pausedFrame: null });
      },

      setPausedFrame: (frame) => {
        set({ pausedFrame: frame });
      },

      addWatch: (expression) => {
        set((state) => {
          if (state.watches.length >= MAX_WATCHES) return state;
          const trimmed = expression.trim();
          if (!trimmed) return state;
          // Dedupe — same expression doesn't add twice.
          if (state.watches.some((w) => w.expression === trimmed)) return state;
          return {
            watches: [...state.watches, { id: nextWatchId(), expression: trimmed }],
          };
        });
      },

      removeWatch: (id) => {
        set((state) => ({
          watches: state.watches.filter((w) => w.id !== id),
        }));
      },

      updateWatchResults: (results) => {
        set((state) => {
          if (!state.pausedFrame) return state;
          return {
            pausedFrame: { ...state.pausedFrame, watchResults: results },
          };
        });
      },

      toggleDrawerCollapsed: () => {
        set((state) => ({ drawerCollapsed: !state.drawerCollapsed }));
      },
    }),
    {
      name: DEBUGGER_STORAGE_KEY,
      version: 1,
      migrate: createMigrate(DEBUGGER_STORAGE_KEY),
      storage: createJSONStorage(() => localStorage),
      // implementation — only persist breakpoints + watches. Session +
      // pausedFrame are transient (rebooting the renderer always
      // detaches; a stale paused frame would be incoherent).
      partialize: (state) => ({
        breakpoints: state.breakpoints,
        breakpointOrder: state.breakpointOrder,
        watches: state.watches,
        drawerCollapsed: state.drawerCollapsed,
      }),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== 'object') return current;
        const candidate = persisted as Partial<DebuggerState>;
        const { breakpoints, breakpointOrder } = sanitizeBreakpoints(
          candidate.breakpoints,
          candidate.breakpointOrder
        );
        const watches = sanitizeWatches(candidate.watches);
        return {
          ...current,
          breakpoints,
          breakpointOrder,
          watches,
          drawerCollapsed:
            typeof candidate.drawerCollapsed === 'boolean'
              ? candidate.drawerCollapsed
              : current.drawerCollapsed,
        };
      },
    }
  )
);
