/**
 * RL-087 — typed contract for filesystem-watcher failures.
 *
 * Pure module — no Electron, no React, no Node-only APIs — so it
 * imports cleanly from `src/main/ipc/fileSystem.ts`, the renderer's
 * `projectStore.ts`, and tests.
 *
 * The classifier maps Node's errno codes to the four buckets the
 * renderer renders distinct copy for. Anything we cannot classify
 * lands in `unknown`; the user still sees a notice but the operator
 * can read the raw `errorMessage` from logs.
 */

export type WatcherFailureKind =
  | 'permission-denied' // EACCES / EPERM
  | 'system-limit' // EMFILE / ENFILE / ENOSPC
  | 'path-not-found' // ENOENT
  | 'unknown';

export interface WatcherDiagnostic {
  kind: WatcherFailureKind;
  rootId: string;
  relativePath: string;
  errorMessage: string;
}

/**
 * Map a thrown value to the matching `WatcherFailureKind`. Falls back
 * to `unknown` rather than throwing — the diagnostic surface is the
 * graceful path, so the classifier should never re-raise.
 */
export function classifyWatcherError(error: unknown): WatcherFailureKind {
  if (error === null || error === undefined) return 'unknown';

  // Node's fs errors carry `code` on the Error object itself.
  const code =
    error instanceof Error && 'code' in error
      ? String((error as Error & { code?: unknown }).code ?? '')
      : typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';

  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'EMFILE' || code === 'ENOSPC' || code === 'ENFILE') return 'system-limit';
  if (code === 'ENOENT') return 'path-not-found';

  // Some platforms throw plain Errors without a `code`; pattern-match
  // the message as a fallback so we still classify common cases.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : '';

  if (/permission denied|EACCES|EPERM/i.test(message)) return 'permission-denied';
  if (/EMFILE|too many open files|ENOSPC|inotify watch limit/i.test(message)) {
    return 'system-limit';
  }
  if (/ENOENT|no such file/i.test(message)) return 'path-not-found';

  return 'unknown';
}

/**
 * Build a typed diagnostic from an error and the watcher's target.
 * The renderer reads `kind` to pick its localized message and uses
 * `rootId` + `relativePath` to disambiguate when multiple projects
 * fail at the same time.
 */
export function buildWatcherDiagnostic(
  error: unknown,
  rootId: string,
  relativePath: string,
): WatcherDiagnostic {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'unknown error';

  return {
    kind: classifyWatcherError(error),
    rootId,
    relativePath,
    errorMessage,
  };
}
