/**
 * RL-102 Slice 1 fold D — Git layer telemetry helpers.
 *
 * Two events:
 *
 *   - `git.layer_attached { repoState }` — once per posture
 *     transition (boot detect + folder switch). Closed-enum
 *     repoState ∈ `GIT_LAYER_REPO_STATES`.
 *   - `git.diff_panel_opened` — once per Git diff panel mount.
 *     Pure counter; no payload.
 *
 * Both go through the same RL-065 telemetry pipeline (`recordEvent`)
 * that gates on consent + closed-enum validation. The renderer
 * cannot bypass the gate — the redactor drops events whose
 * `repoState` doesn't pass `GIT_LAYER_REPO_STATES.has(value)`.
 *
 * A module-level cache squelches duplicate `git.layer_attached`
 * emits for the same `repoState`; the dashboard wants a count of
 * UNIQUE transitions, not per-render burst (the
 * `useGitDetectOnProjectChange` hook re-runs on settings flips).
 */

import { trackEvent } from '../utils/telemetry';

type GitLayerRepoState = 'git-repo' | 'no-git' | 'no-binary';

let lastEmittedRepoState: GitLayerRepoState | null = null;

export function trackGitLayerAttached(repoState: GitLayerRepoState): void {
  if (lastEmittedRepoState === repoState) return;
  lastEmittedRepoState = repoState;
  void trackEvent('git.layer_attached', { repoState });
}

export function trackGitDiffPanelOpened(): void {
  void trackEvent('git.diff_panel_opened', {});
}

/**
 * RL-102 Slice 2 — head-change telemetry. Closed-enum `repoState`
 * reuses `GIT_LAYER_REPO_STATES` so the dashboard groups head
 * changes by posture. `branchChanged` is a boolean payload field;
 * callers only invoke this when the branch genuinely changed (the
 * `branchChanged: false` slot is reserved for future commit-only
 * signal slices and never fires today).
 */
export function trackGitHeadChanged(
  repoState: GitLayerRepoState,
  branchChanged: boolean
): void {
  void trackEvent('git.head_changed', { repoState, branchChanged });
}

/**
 * RL-102 Slice 2 — Reveal-in-Source-Control click telemetry.
 * Closed-enum `target ∈ {'repo-root'}` (extensible for Slice 3+).
 * Mirrored on update-server with parity test.
 */
export function trackGitRevealInSourceControlClicked(
  target: 'repo-root'
): void {
  void trackEvent('git.reveal_in_source_control_clicked', { target });
}

/**
 * RL-102 Slice 2 fold E — outcome telemetry for the
 * reload-from-disk notice. Closed-enum `mode` captures whether the
 * user accepted the reload, rejected it (dismissed the modal /
 * notice), or auto-applied (reserved for a future Slice 3+
 * "auto-reload clean tabs" surface that does not exist today).
 */
export function trackGitExternalModificationReload(
  mode: 'user-accepted' | 'user-rejected' | 'auto-applied'
): void {
  void trackEvent('git.external_modification_reload', { mode });
}

/**
 * Test-only seam — reset the last-emitted cache so vitest cases
 * can assert burst behavior in isolation. NOT exported via the
 * package barrel; tests import the path directly.
 */
export function _resetGitTelemetryCacheForTests(): void {
  lastEmittedRepoState = null;
}
