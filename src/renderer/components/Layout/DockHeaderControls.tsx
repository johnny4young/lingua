import { AutoRunGateNotice } from '../Editor/AutoRunGateNotice';
import { AutoLogStatusPill } from '../Editor/AutoLogStatusPill';
import { RunCapsuleExportButtonHost } from '../Editor/RunCapsuleExportButtonHost';
import { ShareLinkButton } from '../Share/ShareLinkButton';
import { DockOverflowMenu } from './DockOverflowMenu';

/** Auto-run notices, capsule export and share on the dock's tab row; run state and timing live in the run meter. */
export function DockHeaderControls({ compact = false }: { compact?: boolean }) {
  return (
    <div data-testid="result-panel" className="flex min-w-0 shrink-0 items-center gap-1.5">
      {compact ? (
        <DockOverflowMenu />
      ) : (
        <>
          <AutoRunGateNotice />
          <AutoLogStatusPill />
          <RunCapsuleExportButtonHost />
          <ShareLinkButton />
        </>
      )}
    </div>
  );
}
