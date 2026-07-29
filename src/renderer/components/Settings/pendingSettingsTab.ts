/**
 * One-shot handoff for the Settings tab a caller wants opened.
 *
 * Emitting `settings.navigate` right after opening Settings only works when
 * `SettingsModal` is already mounted and listening. It is not: the modal sits
 * behind a lazy boundary, so opening it schedules a chunk fetch and the
 * listener registers whenever that resolves. A caller that opens Settings and
 * immediately asks for a tab is racing the network, and the command lands
 * before anything is subscribed — the modal then opens on its default tab and
 * the CTA silently fails to keep its promise.
 *
 * This removes the race instead of widening it: `requestSettingsTab` first
 * offers the request to an already-mounted modal, then stashes it before
 * opening Settings only when no live owner handled it. The modal reads that
 * stash as its initial state and clears it after the mount commits.
 *
 * Mirrors `pendingCapsuleImport`, which solves the same handoff for the
 * capsule-import overlay.
 */

import type { TabId } from './settingsRailModel';
import { emitCommand } from '../../stores/commandBus';

let pendingTab: TabId | null = null;
let pendingTargetId: string | null = null;

/**
 * Navigate an already-open Settings modal, or seed the next mount.
 *
 * `settings.navigate` is synchronous and SettingsModal marks a valid request
 * handled. That acknowledgement is the source of truth for whether the modal
 * is live; timers and animation frames cannot answer that question for a lazy
 * component. Clearing on the live path also drops any abandoned handoff from
 * an earlier open that was closed before the modal committed.
 */
export function requestSettingsTab(tab: TabId, openSettings?: () => void): void {
  requestSettingsTarget(tab, null, openSettings);
}

/**
 * Navigate to a Settings tab and focus one stable target after it mounts.
 *
 * The target follows the same acknowledged live-owner handoff as the tab, so
 * lazy loading cannot drop it between opening Settings and mounting the owner.
 */
export function requestSettingsTarget(
  tab: TabId,
  targetId: string | null,
  openSettings?: () => void
): void {
  const liveNavigation = emitCommand('settings.navigate', {
    tab,
    ...(targetId ? { targetId } : {}),
  });
  if (liveNavigation.handled) {
    clearPendingSettingsTab();
    return;
  }
  if (!openSettings) return;

  setPendingSettingsTab(tab);
  pendingTargetId = targetId;
  openSettings();
}

/** Stash the tab the next Settings open should land on. */
export function setPendingSettingsTab(tab: TabId): void {
  pendingTab = tab;
}

/**
 * Read the stashed tab WITHOUT consuming it.
 *
 * Deliberately split from clearing. The reader is a `useState` initializer,
 * which runs during render — and a render can be thrown away, which is not
 * hypothetical here: the modal is lazy, so its first render suspends on the
 * chunk fetch and React discards it. A consuming read would hand the tab to
 * that discarded attempt and leave the real mount with nothing, which is
 * exactly the bug this module was written to fix, one layer down.
 */
export function peekPendingSettingsTab(): TabId | null {
  return pendingTab;
}

/** Read the stable focus target requested for the next Settings mount. */
export function peekPendingSettingsTarget(): string | null {
  return pendingTargetId;
}

/** Drop the stash. Call from an effect, once the read has actually stuck. */
export function clearPendingSettingsTab(): void {
  pendingTab = null;
  pendingTargetId = null;
}
