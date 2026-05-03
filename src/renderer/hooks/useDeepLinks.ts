import { useEffect, useEffectEvent, useState } from 'react';
import { createDefaultTab, useEditorStore } from '../stores/editorStore';
import { useSnippetsStore } from '../stores/snippetsStore';
import type { AppOverlay } from './useGlobalShortcuts';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { parentDirOf } from '../utils/filePath';
import type { DeepLinkTarget } from '../../shared/deepLinks';

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
}

interface UseDeepLinksOptions {
  openOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
}

export function useDeepLinks({ openOverlay }: UseDeepLinksOptions): boolean {
  const [hasHandledDeepLink, setHasHandledDeepLink] = useState(false);

  const applyDeepLink = useEffectEvent(async (target: DeepLinkTarget) => {
    setHasHandledDeepLink(true);

    try {
      if (target.kind === 'open-file') {
        const name = fileNameFromPath(target.filePath);
        const language = resolveFileLanguageOrPlaintext(name);
        // RL-077 — mint a capability for the file's parent directory
        // and open under the new contract. Re-mint failures (path
        // missing, denylisted, not a directory) just skip the open;
        // the user-visible feedback is no tab appearing.
        const { parent, basename } = parentDirOf(target.filePath);
        const reopen = await window.lingua.fs.reopenRoot(parent);
        if (!reopen.ok) {
          console.warn(
            '[deep-links] reopenRoot rejected target',
            target.filePath,
            reopen.error
          );
          return;
        }
        await useEditorStore
          .getState()
          .openFile(reopen.rootId, basename, name, language, target.filePath);
        return;
      }

      if (target.kind === 'new-file') {
        useEditorStore.getState().addTab(createDefaultTab(target.language));
        return;
      }

      useSnippetsStore.getState().setPendingLinkedSnippetId(target.snippetId);
      openOverlay('snippets');
    } catch (error) {
      console.error('[deep-links] Failed to handle deep link', target, error);
    }
  });

  useEffect(() => {
    const deepLinks = window.lingua?.deepLinks;
    if (!deepLinks) {
      return;
    }

    const unsubscribe = deepLinks.onLink((target) => {
      void applyDeepLink(target);
    });
    deepLinks.markReady();
    void deepLinks.consumePending().then((target) => {
      if (target) {
        return applyDeepLink(target);
      }
    });

    return unsubscribe;
  }, [applyDeepLink]);

  return hasHandledDeepLink;
}
