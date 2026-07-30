import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARE_FRAGMENT_PREFIX } from '../../shared/shareProtocol';
import { useStatusNotice } from './useStatusNotice';
import { isSafeMode } from '../utils/safeBoot';
import { loadShareLinkImport } from './shareLinkImportLoader';

export interface UseShareLinkBootOptions {
  readonly enabled?: boolean;
}

function normalizeShareFragment(rawHash: string): string | null {
  if (!rawHash || rawHash === '#') return null;
  const fragment = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  return fragment.startsWith(SHARE_FRAGMENT_PREFIX) ? fragment : null;
}

/**
 * Startup-safe hash listener.
 *
 * Normal workspaces retain only the protocol discriminator and listener. The
 * gzip/JSON decoder, telemetry, stores, and tab importer load after a matching
 * #share=v1 fragment appears, including a hashchange after initial boot.
 */
export function useShareLinkBoot({ enabled = true }: UseShareLinkBootOptions = {}): void {
  const { i18n } = useTranslation();
  const { error: pushErrorNotice } = useStatusNotice();
  const pendingHashesRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || isSafeMode()) return;

    const handleHash = (rawHash: string) => {
      const fragment = normalizeShareFragment(rawHash);
      if (!fragment || pendingHashesRef.current.has(fragment)) return;
      pendingHashesRef.current.add(fragment);
      void loadShareLinkImport()
        .then(module => module.importShareLinkHash(fragment))
        .catch((error: unknown) => {
          console.error('[share] failed to load the share-link importer', error);
          pushErrorNotice('share.notice.loadFailed');
        })
        .finally(() => {
          pendingHashesRef.current.delete(fragment);
        });
    };

    handleHash(window.location.hash);

    const onHashChange = (event: HashChangeEvent) => {
      try {
        handleHash(new URL(event.newURL).hash);
      } catch {
        // A real hashchange carries a valid URL. Ignore malformed synthetic
        // events rather than interpreting an untrusted string as a fragment.
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [enabled, i18n.language, pushErrorNotice]);
}
