/**
 * Shared read-only Git contracts crossing main, preload, and renderer.
 *
 * Keeping these shapes outside the Electron implementation lets the ambient
 * bridge declarations alias one canonical source instead of copying the IPC
 * payloads into every surface.
 */

export interface GitDetectResult {
  installed: boolean;
  /** `git --version` output, for example `git version 2.45.2`. */
  version?: string;
  /** Absolute path of the repository root. */
  repoRoot?: string;
  /** Current branch name. Absent on detached HEAD. */
  branch?: string;
  /** Diagnostic message when Git detection fails. */
  error?: string;
}

export type GitFileStatusKind = 'clean' | 'modified' | 'untracked' | 'unknown';

export interface GitFileStatus {
  status: GitFileStatusKind;
  /** Lines added; absent for untracked files. */
  insertions?: number;
  /** Lines removed; absent for untracked files. */
  deletions?: number;
}

export interface GitFileDiff {
  /** Content from HEAD, or empty for an untracked file or missing HEAD. */
  originalContent: string;
  /** Current on-disk content, or empty when the file is deleted. */
  modifiedContent: string;
  /** True when either side reached the configured diff byte cap. */
  truncated: boolean;
}

export interface GitHeadChangePayload {
  repoRoot: string;
  /** `null` explicitly clears a previously known branch on detached HEAD. */
  branch?: string | null;
  commit?: string;
  branchChanged: boolean;
}

export interface GitHeadWatcherDiagnostic {
  repoRoot: string;
  reason: 'give-up' | 'resolve-error';
}

/** Public bridge name retained for compatibility with the ambient API. */
export type GitHeadWatcherFailurePayload = GitHeadWatcherDiagnostic;
