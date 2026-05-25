/**
 * RL-102 Slice 2 Fold C — project-wide branch indicator chip.
 *
 * Scope-trim rationale (vs the original Suggested change C):
 *   The original fold C proposed seeding a future RL-112
 *   "Persistent status bar." That bar does not yet exist in
 *   Lingua. Building it would be a larger scope (a dedicated 24px
 *   bottom strip with lint counts, cursor pos, encoding, indent,
 *   git, run status — see PLAN.md § RL-112). Instead, this slice
 *   ships a small chip mounted to the RIGHT of the editor-tabs
 *   chrome — single source of truth for the branch name AT THE
 *   PROJECT LEVEL, complementing the per-tab `<GitStatusPill>`
 *   which carries per-file status + the branch in its tooltip.
 *
 * RL-112 can later relocate this chip into the persistent status
 * bar by lifting the `<GitProjectBranchChip>` mount one parent up
 * — the component's read path is `useGitStore.posture.branch`, so
 * a future bar that consumes the same selector keeps the contract
 * intact.
 *
 * Self-gates:
 *   - `posture.available === false` → null.
 *   - `posture.branch === undefined` (detached HEAD) → renders
 *     the "detached HEAD" label so the user still sees a signal
 *     instead of nothing.
 *
 * The chip is visually compact (10px text, 6px padding) to match
 * the per-tab pill's chrome. Color: low-contrast slate so it does
 * not compete with the tab list's hover state.
 */

import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGitStore } from '../../stores/gitStore';

export function GitProjectBranchChip() {
  const { t } = useTranslation();
  const posture = useGitStore((state) => state.posture);

  if (!posture?.available) return null;

  const branchLabel =
    posture.branch ?? t('editor.git.tooltip.detachedHead');
  const tooltip = posture.commit
    ? `${branchLabel} · ${posture.commit.slice(0, 7)}`
    : branchLabel;

  return (
    <div
      data-testid="git-project-branch-chip"
      data-git-branch={posture.branch ?? null}
      title={tooltip}
      aria-label={tooltip}
      className="flex h-full shrink-0 items-center gap-1 border-l border-border/60 px-2 text-[11px] text-muted"
    >
      <GitBranch size={11} aria-hidden="true" className="opacity-70" />
      <span className="truncate max-w-[160px]">{branchLabel}</span>
    </div>
  );
}
