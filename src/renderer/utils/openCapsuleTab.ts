/**
 * RL-094 Slice 3 — open a capsule's source in a fresh editor tab.
 *
 * Shared by the capsule import flow (`useCapsuleImport`) and the
 * capsule browse overlay (`<CapsuleListOverlay>`) so both surfaces
 * apply the same "open the SOURCE, never auto-replay" contract.
 *
 * Runtime + workflow mode are deliberately NOT threaded from the
 * capsule — the new tab starts in `createDefaultTab` defaults so the
 * user has to explicitly Run / Cmd+Enter to re-execute. "No silent
 * execution" is the core RL-094 promise; opening a capsule must never
 * run code on its own.
 */

import { useEditorStore, createDefaultTab } from '../stores/editorStore';
import type { RunCapsuleV1 } from '../../shared/runCapsule';
import type { Language } from '../types';

export function openCapsuleSourceInNewTab(capsule: RunCapsuleV1): void {
  const editor = useEditorStore.getState();
  const language = (capsule.tab.language || 'javascript') as Language;
  const defaults = createDefaultTab(language);
  editor.addTab({
    ...defaults,
    content: capsule.source.content,
    name: capsule.tab.name?.trim().length
      ? capsule.tab.name.trim()
      : defaults.name,
  });
}
