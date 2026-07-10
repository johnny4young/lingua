import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { DeveloperUtilityPanelCache } from './UtilityPanelCache';

export function DeveloperUtilityPanel({
  toolId,
  mountedToolIds = [toolId],
  active = true,
}: {
  toolId: DeveloperUtilityId;
  mountedToolIds?: DeveloperUtilityId[];
  active?: boolean;
}) {
  return (
    <DeveloperUtilityPanelCache toolId={toolId} mountedToolIds={mountedToolIds} active={active} />
  );
}
