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
 * run code on its own. IT2-F5 restores the inert stdin/argv snapshot and
 * optional set name so an explicitly-triggered replay receives the same input.
 *
 * RL-099 Slice 3 fold C — non-code capsules. `capsule.tab.language`
 * is a string that, for workspace-kind capsules, is NOT a real editor
 * language pack id: `'http'` (RL-097) and now `'pipeline'` (RL-099)
 * are neutral markers, not packs. The previous code cast the token
 * straight to `Language` and handed it to `createDefaultTab`, which
 * minted a tab whose `language` was an unrunnable, mis-highlighted
 * token (and `extensionForLanguage` / `monacoLanguageFor` fell back to
 * plaintext anyway). We now resolve the token against the real pack set
 * and, when it isn't a pack, open the source under `createDefaultTab`'s
 * own default language so the recipe/text renders readably in a normal,
 * runnable tab instead of a broken one. The capsule name is preserved
 * either way.
 */

import { useEditorStore, createDefaultTab } from '../stores/editorStore';
import { getLanguagePackById } from '../../shared/languagePacks';
import type { RunCapsuleV1 } from '../../shared/runCapsule';
import type { Language } from '../types';

/**
 * Resolve the capsule's stored language token to a real editor
 * `Language`, or `undefined` when it is not a known language pack id
 * (e.g. the workspace-kind markers `'http'` / `'pipeline'`). Plugins
 * register through the pack registry too, so a plugin language still
 * resolves here.
 */
function resolveEditorLanguage(token: string): Language | undefined {
  if (token.length === 0) return undefined;
  return getLanguagePackById(token)?.id;
}

export function openCapsuleSourceInNewTab(capsule: RunCapsuleV1): void {
  const editor = useEditorStore.getState();
  // Fall through to `createDefaultTab`'s own default language when the
  // capsule's token is not a real pack — never hand a workspace-kind
  // marker to the editor as if it were a language.
  const editorLanguage = resolveEditorLanguage(capsule.tab.language);
  const defaults =
    editorLanguage !== undefined
      ? createDefaultTab(editorLanguage)
      : createDefaultTab();
  const restoredInputSet = capsule.input.setName
    ? {
        id: crypto.randomUUID(),
        name: capsule.input.setName,
        stdin: capsule.input.stdin ?? '',
        ...(capsule.input.args && capsule.input.args.length > 0
          ? { args: [...capsule.input.args] }
          : {}),
      }
    : null;
  editor.addTab({
    ...defaults,
    content: capsule.source.content,
    name: capsule.tab.name?.trim().length
      ? capsule.tab.name.trim()
      : defaults.name,
    ...(capsule.input.stdin ? { stdinBuffer: capsule.input.stdin } : {}),
    ...(capsule.input.args && capsule.input.args.length > 0
      ? { inputArgs: [...capsule.input.args] }
      : {}),
    ...(restoredInputSet
      ? {
          inputSets: [restoredInputSet],
          activeInputSetId: restoredInputSet.id,
        }
      : {}),
  });
}
