/**
 * RL-102 Slice 1 — visibility selector for the Git diff bottom-panel
 * sibling tab. Returns `true` when the boot detect resolved to a
 * usable git repo, the active tab has a `filePath` (the diff has
 * nothing to show for an unsaved Scratchpad), and the tab has not
 * opted out via `// @git-ignore-status`.
 *
 * Mirrors the shape of `useDependenciesPanelAvailable` from RL-025
 * Slice A — same `useXxxAvailable` naming so AppLayout can swap in
 * the toggle without learning a new pattern.
 */

import { useEditorStore } from '../../stores/editorStore';
import { gitLayerAvailable, useGitStore } from '../../stores/gitStore';
import { gitStatusSuppressedByMagicComment } from '../../utils/magicComments';

export function useGitDiffTabAvailable(): boolean {
  const posture = useGitStore((s) => s.posture);
  const activeTabEligible = useEditorStore((s) => {
    if (!s.activeTabId) return false;
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab?.filePath) return false;
    return !gitStatusSuppressedByMagicComment(
      tab.language ?? '',
      tab.content
    );
  });
  if (!gitLayerAvailable(posture)) return false;
  return activeTabEligible;
}
