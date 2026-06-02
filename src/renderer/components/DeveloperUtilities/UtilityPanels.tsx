import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { DEVELOPER_UTILITY_PANEL_COMPONENTS } from './UtilityPanelRegistry';

/**
 * RL-125 — Suspense fallback shown while a tool's lazily-imported panel chunk
 * loads on first selection. Copy routes through i18n so it localizes; the
 * `role="status"` + `aria-live` keep screen readers informed of the transient
 * loading state without stealing focus.
 */
function UtilityPanelFallback() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-[12rem] items-center justify-center text-xs text-muted"
      role="status"
      aria-live="polite"
      data-testid="utility-panel-loading"
    >
      {t('utilities.panel.loading')}
    </div>
  );
}

export function DeveloperUtilityPanel({ toolId }: { toolId: DeveloperUtilityId }) {
  const Panel = DEVELOPER_UTILITY_PANEL_COMPONENTS[toolId];
  return (
    <Suspense fallback={<UtilityPanelFallback />}>
      <Panel />
    </Suspense>
  );
}
