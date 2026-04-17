import { useEffect, useEffectEvent, useState } from 'react';
import { createDefaultTab, useEditorStore } from '../stores/editorStore';
import { useSnippetsStore } from '../stores/snippetsStore';
import type { AppOverlay } from './useGlobalShortcuts';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
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
        await useEditorStore.getState().openFile(target.filePath, name, language);
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
