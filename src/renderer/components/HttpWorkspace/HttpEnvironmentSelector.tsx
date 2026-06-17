/**
 * RL-097 Slice 3a — active-environment selector.
 *
 * A compact dropdown bound to the store's `activeEnvironmentId` plus a
 * "Manage" affordance that opens the environment manager. Rendered in
 * the editor header next to the method/URL row. Purely presentational —
 * selection + open are driven by the props the panel wires to the
 * store.
 */

import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HttpEnvironmentV1 } from '../../../shared/httpEnvironment';

export interface HttpEnvironmentSelectorProps {
  environments: ReadonlyArray<HttpEnvironmentV1>;
  activeEnvironmentId: string | null;
  /** Select an environment by id, or null for "No environment". */
  onSelect: (id: string | null) => void;
  /** Open the environment manager modal. */
  onManage: () => void;
}

export function HttpEnvironmentSelector({
  environments,
  activeEnvironmentId,
  onSelect,
  onManage,
}: HttpEnvironmentSelectorProps) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <label className="sr-only" htmlFor="http-environment-selector">
        {t('httpWorkspace.environment.selector.label')}
      </label>
      <select
        id="http-environment-selector"
        data-testid="http-environment-selector"
        value={activeEnvironmentId ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          onSelect(next.length > 0 ? next : null);
        }}
        aria-label={t('httpWorkspace.environment.selector.label')}
        title={t('httpWorkspace.environment.selector.label')}
        className="h-8 max-w-[160px] shrink-0 rounded-md border border-border-subtle bg-bg-panel px-2 text-xs font-medium text-fg-base focus:border-border-strong focus:outline-none"
      >
        <option value="">{t('httpWorkspace.environment.selector.none')}</option>
        {environments.map((env) => (
          <option key={env.id} value={env.id}>
            {env.name.length > 0
              ? env.name
              : t('httpWorkspace.environment.unnamed')}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onManage}
        data-testid="http-environment-manage"
        aria-label={t('httpWorkspace.environment.manage')}
        title={t('httpWorkspace.environment.manage')}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Settings2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
