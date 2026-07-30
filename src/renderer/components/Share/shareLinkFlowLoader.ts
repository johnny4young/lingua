import type { ComponentType } from 'react';
import type { ShareLinkFlowProps } from './ShareLinkFlow';

interface ShareLinkFlowModule {
  ShareLinkFlow: ComponentType<ShareLinkFlowProps>;
}

let flowPromise: Promise<ShareLinkFlowModule> | null = null;

/**
 * Cache a successful implementation load for the session. A rejected chunk is
 * evicted so a later share command can retry after a transient network error.
 */
export function loadShareLinkFlow(): Promise<ShareLinkFlowModule> {
  flowPromise ??= import('./ShareLinkFlow');
  return flowPromise.catch((error: unknown) => {
    flowPromise = null;
    throw error;
  });
}
