import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { UtilityPanelActiveContext } from '../../hooks/utilityPanelActive';
import { DEVELOPER_UTILITY_PANEL_COMPONENTS } from './UtilityPanelRegistry';

/**
 * internal — Suspense fallback shown while a tool's lazily-imported panel chunk
 * loads on first selection. Copy routes through i18n so it localizes; the
 * `role="status"` + `aria-live` keep screen readers informed of the transient
 * loading state without stealing focus.
 */
function UtilityPanelFallback() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-[12rem] items-center justify-center text-body-sm text-muted"
      role="status"
      aria-live="polite"
      data-testid="utility-panel-loading"
    >
      {t('utilities.panel.loading')}
    </div>
  );
}

export interface DeveloperUtilityPanelCacheProps {
  toolId: DeveloperUtilityId;
  mountedToolIds: DeveloperUtilityId[];
  active?: boolean;
}

/**
 * Memoized: the workspace body re-renders on every SEARCH keystroke, and
 * without the memo boundary each keystroke would re-render every visited
 * (hidden) panel subtree. Props change only on real navigation
 * (toolId/active) or when a new id joins the visited list.
 */
export const DeveloperUtilityPanelCache = memo(function DeveloperUtilityPanelCache({
  toolId,
  mountedToolIds,
  active = true,
}: DeveloperUtilityPanelCacheProps) {
  const visibleToolIds = mountedToolIds.includes(toolId)
    ? mountedToolIds
    : [...mountedToolIds, toolId];

  return (
    <>
      {visibleToolIds.map(mountedToolId => {
        const Panel = DEVELOPER_UTILITY_PANEL_COMPONENTS[mountedToolId];
        const panelActive = active && mountedToolId === toolId;
        return (
          <div
            key={mountedToolId}
            hidden={!panelActive}
            aria-hidden={!panelActive}
            data-testid={`utility-panel-cache-${mountedToolId}`}
          >
            <UtilityPanelActiveContext.Provider value={panelActive}>
              <Suspense fallback={<UtilityPanelFallback />}>
                <Panel />
              </Suspense>
            </UtilityPanelActiveContext.Provider>
          </div>
        );
      })}
    </>
  );
});
