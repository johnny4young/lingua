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
 * Test-only seam — reset the last-emitted cache so vitest cases
 * can assert burst behavior in isolation. NOT exported via the
 * package barrel; tests import the path directly.
 */
export function _resetGitTelemetryCacheForTests(): void {
  lastEmittedRepoState = null;
}
