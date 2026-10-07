import { useEffect, useEffectEvent, useState } from 'react';
import { createDefaultTab, useEditorStore } from '../stores/editorStore';
import { useSnippetsStore } from '../stores/snippetsStore';
import type { AppOverlay } from './useGlobalShortcuts';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { notifyBlockedPath } from '../utils/blockedPath';
import type { DeepLinkTarget } from '../../shared/deepLinks';
import { offerLicenseTokenPrefill } from '../components/Settings/pendingLicenseToken';
import { requestSettingsTarget } from '../components/Settings/pendingSettingsTab';

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
        // Mint a capability for this approved file only.
        // Re-mint failures (path missing, denylisted, not approved)
        // just skip the open; the user-visible feedback is no tab
        // appearing.
        const reopen = await window.lingua.fs.reopenFile(target.filePath);
        if (!reopen.ok) {
          if (reopen.error === 'blocked') void notifyBlockedPath(target.filePath);
          console.warn(
            '[deep-links] reopenFile rejected target',
            target.filePath,
            reopen.error
          );
          return;
        }
        await useEditorStore
          .getState()
          .openFile(reopen.rootId, reopen.fileRelativePath, name, language, target.filePath);
        return;
      }

      if (target.kind === 'new-file') {
        useEditorStore.getState().addTab(createDefaultTab(target.language));
        return;
      }

      if (target.kind === 'license-token') {
        offerLicenseTokenPrefill(target.token);
        requestSettingsTarget('account', 'license-token-input', () => openOverlay('settings'));
        return;
      }

      useSnippetsStore.getState().setPendingLinkedSnippetId(target.snippetId);
      openOverlay('snippets');
    } catch (error) {
      // A license target carries a credential; never log it.
      const logged = target.kind === 'license-token' ? target.kind : target;
      console.error('[deep-links] Failed to handle deep link', logged, error);
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
    void deepLinks
      .consumePending()
      .then((target) => {
        if (target) {
          return applyDeepLink(target);
        }
      })
      .catch((error) => {
        // IPC for the pending deep link failed; nothing to open.
        // markReady() above already let main know the renderer is live.
        console.warn('[deep-links] consumePending failed', error);
      });

    return unsubscribe;
  }, []);

  return hasHandledDeepLink;
}
