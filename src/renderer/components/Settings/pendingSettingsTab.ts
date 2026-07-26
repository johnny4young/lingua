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
 * This removes the race instead of widening it: the caller stashes the tab,
 * the modal reads it as its initial state on mount, whenever that happens.
 * One-shot (take clears it) so a tab requested once never re-selects itself
 * the next time the user opens Settings from somewhere else.
 *
 * Mirrors `pendingCapsuleImport`, which solves the same handoff for the
 * capsule-import overlay.
 */

import type { TabId } from './settingsRailModel';

let pendingTab: TabId | null = null;

/** Stash the tab the next Settings open should land on. */
export function setPendingSettingsTab(tab: TabId): void {
  pendingTab = tab;
}

/** Return and clear the stashed tab, or null when none is pending. */
export function takePendingSettingsTab(): TabId | null {
  const tab = pendingTab;
  pendingTab = null;
  return tab;
}
