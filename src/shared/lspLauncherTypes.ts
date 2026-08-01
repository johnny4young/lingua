/** Status contracts emitted by desktop language-server launchers. */

export type LspLauncherStatus =
  | { kind: 'unknown' }
  | { kind: 'starting' }
  | { kind: 'running'; version: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'startup-failed'; error: string }
  | { kind: 'degraded'; error: string }
  | { kind: 'stopped' };

/** Rust starts eagerly and never emits the Go store's idle states. */
export type RustAnalyzerStatus = Exclude<
  LspLauncherStatus,
  { kind: 'unknown' | 'stopped' }
>;

export type GoplsStatus = LspLauncherStatus;
