import { Loader2 } from 'lucide-react';
import { formatExecTime } from '../../hooks/runnerOutput';
import { useResultStore } from '../../stores/resultStore';
import { AutoRunGateNotice } from '../Editor/AutoRunGateNotice';
import { AutoLogStatusPill } from '../Editor/AutoLogStatusPill';
import { RecentRunsPill } from '../Editor/RecentRunsPill';
import { RunCapsuleExportButtonHost } from '../Editor/RunCapsuleExportButtonHost';
import { RunStatusPill } from '../Editor/RunStatusPill';
import { ShareLinkButton } from '../Share/ShareLinkButton';

/** Run status, history, timing, capsule export and share, on the dock's tab row. */
export function DockHeaderControls() {
  const executionTime = useResultStore(state => state.executionTime);
  const isAutoRunning = useResultStore(state => state.isAutoRunning);

  return (
    <div data-testid="result-panel" className="flex min-w-0 shrink-0 items-center gap-1.5">
      {isAutoRunning ? <Loader2 size={13} className="animate-spin text-accent-fg" /> : null}
      <AutoRunGateNotice />
      <AutoLogStatusPill />
      <RunStatusPill />
      <RecentRunsPill />
      {executionTime !== null ? (
        <span
          data-testid="dock-execution-time"
          className="status-pill whitespace-nowrap tabular-nums"
        >
          {formatExecTime(executionTime)}
        </span>
      ) : null}
      <RunCapsuleExportButtonHost />
      <ShareLinkButton />
    </div>
  );
}
