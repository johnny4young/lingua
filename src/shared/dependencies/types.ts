/**
 * implementation — shared types + closed enums for dependency
 * detection.
 *
 * implementation only — detection + classification + read-only UI. implementation
 * (JS/TS desktop install via `child_process.spawn`) and implementation
 * (Python `micropip`) will land transitions for `installing` /
 * `failed` over this same enum without churning the schema.
 *
 * The adapter contract is intentionally tiny: a `detect(source)` pure
 * helper that returns `DetectedDependency[]` from a buffer. The
 * runtime-specific resolver (`node_modules` check, Pyodide
 * loaded-packages snapshot) lives outside the adapter so the
 * detector stays pure + testable without IPC mocks.
 */

/**
 * Closed enum mirroring the classification states described in the
 * internal scope. Adapters return one of these per detected
 * specifier. The renderer's panel renders a status pill per row.
 */
export type DependencyStatus =
  | 'detected'
  | 'installed'
  | 'installing'
  | 'failed'
  | 'unsupported'
  | 'needs-desktop';

/**
 * Closed enum of language ids the registry targets in implementation. Other
 * languages are intentionally `Planned` — adding them is a separate
 * adapter implementation each (see the internal dependency-manager ADR).
 */
export type DependencyAdapterLanguage = 'javascript' | 'typescript' | 'python';

/**
 * One specifier extracted from the active buffer. `name` is the
 * top-level package as a user would `npm install` / `pip install`.
 * `submodule` is the path under the package when the import had one
 * (`pkg/sub` → `name: 'pkg', submodule: 'sub'`); kept for future
 * "Install with submodule" install-path UX in implementation and so
 * dashboards can see how often deep imports appear.
 */
export interface DetectedDependency {
  readonly name: string;
  readonly submodule?: string;
  /**
   * Closed-enum `kind`: `'import'` for ES module imports + dynamic
   * `import('x')`, `'require'` for CommonJS `require('x')`, `'from'`
   * for Python `from x import …`, and `'import'` (same kind) for
   * plain Python `import x` / `import x as y`. Drives no behaviour in
   * implementation — kept on the type so a future Settings filter or
   * telemetry surface can split adoption per syntax.
   */
  readonly kind: 'import' | 'require' | 'from';
}

/**
 * Closed bucket enum for the `dependency.detected_in_tab` event.
 * Mirrored in `update-server/src/telemetry.ts`; a parity test asserts
 * both sides stay aligned.
 */
export const DEPENDENCY_COUNT_BUCKETS = [
  '0',
  '1',
  '2-5',
  '6-10',
  '>10',
] as const;
export type DependencyCountBucket =
  (typeof DEPENDENCY_COUNT_BUCKETS)[number];

export function bucketDependencyCount(
  count: number
): DependencyCountBucket {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 10) return '6-10';
  return '>10';
}

/**
 * Soft cap on the buffer size we feed to the detector. Larger
 * buffers skip detection altogether and the panel surfaces a notice
 * once per session (see `useDependencyDetection`). 500 KB is well
 * above any reasonable scratchpad and well below the renderer's
 * blocking-time budget for a single acorn parse pass on cold cache.
 */
export const DEPENDENCY_DETECTION_MAX_BUFFER_BYTES = 500 * 1024;

export interface DependencyAdapter {
  readonly language: DependencyAdapterLanguage;
  /**
   * Extract specifiers from a source buffer. MUST be a pure function
   * — no globals, no Pyodide / acorn-worker IO, no main IPC. Caller
   * memoises by content hash so the detector cost only pays on real
   * edits. Implementations swallow parse errors and return whatever
   * was extractable before the parser gave up (best-effort, never
   * throws to the caller).
   */
  detect(source: string): DetectedDependency[];
}

/**
 * implementation — closed enum for the install batch outcome. One
 * outcome per batch (a click can install N specifiers at once with
 * implementation note B coalescing). Mirrored on `update-server/src/telemetry.ts`;
 * the parity test enforces lockstep.
 */
export const DEPENDENCY_INSTALL_OUTCOMES = [
  'success',
  'partial',
  'failed',
  'cancelled',
  'timed-out',
] as const;
export type DependencyInstallOutcome =
  (typeof DEPENDENCY_INSTALL_OUTCOMES)[number];

/**
 * implementation — closed enum for the failure-reason rollup. Fires
 * at most once per failed/partial batch with the dominant reason so
 * dashboards can split network errors from policy refusals without
 * leaking npm stderr verbatim.
 */
// implementation — `unsupported-wheel` covers Pyodide micropip native-
// wheel rejections (recoverable: the user can switch to a pure-Python
// alternative). The closed enum keeps that distinction in the dashboard
// rather than bucketing it under `unknown`. Comment is intentionally
// outside the array literal so the regex-driven parity test in
// update-server stays single-quote clean.
export const DEPENDENCY_INSTALL_FAILURE_REASONS = [
  'invalid-specifier',
  'no-package-json',
  'binary-missing',
  'exit-nonzero',
  'timeout',
  'cancelled',
  'unsupported-wheel',
  'unknown',
] as const;
export type DependencyInstallFailureReason =
  (typeof DEPENDENCY_INSTALL_FAILURE_REASONS)[number];
