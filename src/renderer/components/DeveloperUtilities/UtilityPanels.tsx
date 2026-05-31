import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { DEVELOPER_UTILITY_PANEL_COMPONENTS } from './UtilityPanelRegistry';

export function DeveloperUtilityPanel({ toolId }: { toolId: DeveloperUtilityId }) {
  const Panel = DEVELOPER_UTILITY_PANEL_COMPONENTS[toolId];
  return <Panel />;
}
