import { Fragment, type ReactNode, useState } from 'react';
import { clearE2eWorkspaceCrash, shouldE2eWorkspaceCrash } from '../../testing/e2eHooks';
import { ErrorBoundary } from '../ErrorBoundary';

export type WorkspaceErrorBoundaryRegion = 'notebook' | 'sql' | 'http' | 'utilities';

interface WorkspaceErrorBoundaryProps {
  children: ReactNode;
  region: WorkspaceErrorBoundaryRegion;
}

function E2eWorkspaceCrashProbe({ region }: { region: WorkspaceErrorBoundaryRegion }) {
  if (__LINGUA_E2E_HOOKS__ && shouldE2eWorkspaceCrash(region)) {
    throw new Error(`[E2E] intentional ${region} workspace render crash`);
  }
  return null;
}

/**
 * Contains a lazy workspace failure inside the editor area. Retrying changes
 * the boundary key so React constructs a fresh boundary and subtree without
 * resetting the tab or any workspace-owned store.
 */
export function WorkspaceErrorBoundary({ children, region }: WorkspaceErrorBoundaryProps) {
  const [retryKey, setRetryKey] = useState(0);

  const retry = () => {
    if (__LINGUA_E2E_HOOKS__) clearE2eWorkspaceCrash(region);
    setRetryKey(current => current + 1);
  };

  return (
    <ErrorBoundary key={`${region}-${retryKey}`} region={region} variant="panel" onRetry={retry}>
      <Fragment>
        <E2eWorkspaceCrashProbe region={region} />
        {children}
      </Fragment>
    </ErrorBoundary>
  );
}
