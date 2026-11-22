import { AutoRunGateNotice } from '../Editor/AutoRunGateNotice';
import { AutoLogStatusPill } from '../Editor/AutoLogStatusPill';
import { RunCapsuleExportButtonHost } from '../Editor/RunCapsuleExportButtonHost';
import { ShareLinkButton } from '../Share/ShareLinkButton';

/** Auto-run notices, capsule export and share on the dock's tab row; run state and timing live in the run meter. */
export function DockHeaderControls() {
  return (
    <div data-testid="result-panel" className="flex min-w-0 shrink-0 items-center gap-1.5">
      <AutoRunGateNotice />
      <AutoLogStatusPill />
      <RunCapsuleExportButtonHost />
      <ShareLinkButton />
    </div>
  );
}
