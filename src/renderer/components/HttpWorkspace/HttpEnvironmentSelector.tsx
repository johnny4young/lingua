/**
 * The HTTP tab's context in the command bar: the active environment and its
 * variable count. The menu picks an environment (or none) and opens the
 * environment manager.
 */

import { Check, Settings2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpEnvironmentV1 } from '../../../shared/httpEnvironment';
import '../../i18n/httpBuilderCatalog';
import { useDismissible } from '../../hooks/useDismissible';
import { CommandBarContextChip } from '../Chrome/CommandBarSlot';
import type { HttpTint } from './httpScopeColors';

export interface HttpEnvironmentSelectorProps {
  environments: ReadonlyArray<HttpEnvironmentV1>;
  activeEnvironmentId: string | null;
  /** Select an environment by id, or null for "No environment". */
  onSelect: (id: string | null) => void;
  /** Open the environment manager modal. */
  onManage: () => void;
  /** The active environment's colour, for its dot. */
  tint?: HttpTint;
}

const ROW =
  'focus-ring dropdown-rich-row w-full items-center py-2 [&_.row-label]:text-body-sm [&_.row-label]:font-medium';

export function HttpEnvironmentSelector({
  environments,
  activeEnvironmentId,
  onSelect,
  onManage,
  tint,
}: HttpEnvironmentSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const active = environments.find((env) => env.id === activeEnvironmentId) ?? null;
  const nameOf = (env: HttpEnvironmentV1) => (env.name.length > 0 ? env.name : t('httpWorkspace.environment.unnamed'));
  const name = active ? nameOf(active) : t('httpWorkspace.environment.selector.none');

  useDismissible(open, rootRef, setOpen, chipRef);

  const choose = (id: string | null) => {
    setOpen(false);
    onSelect(id);
  };

  const option = (id: string | null, label: string, count?: number) => (
    <button
      key={id ?? 'none'}
      type="button"
      role="menuitemradio"
      aria-checked={activeEnvironmentId === id}
      data-testid={`http-environment-option-${id ?? 'none'}`}
      onClick={() => choose(id)}
      className={ROW}
    >
      <span className="row-icon">{activeEnvironmentId === id ? <Check size={13} aria-hidden /> : null}</span>
      <span className="row-label truncate">{label}</span>
      {count === undefined ? (
        <span />
      ) : (
        <span className="font-mono text-caption text-fg-muted">
          {t('httpWorkspace.environment.selector.variables', { count })}
        </span>
      )}
    </button>
  );

  return (
    <div ref={rootRef} className="relative inline-flex items-stretch">
      <CommandBarContextChip
        ref={chipRef}
        testId="http-environment-selector"
        badge="http"
        leading={
          tint ? (
            <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: tint.fg }} />
          ) : null
        }
        name={name}
        {...(active ? { detail: t('httpWorkspace.environment.selector.variables', { count: active.variables.length }) } : {})}
        popup="menu"
        expanded={open}
        ariaLabel={`${t('httpWorkspace.environment.selector.label')}: ${name}`}
        data={{ 'data-environment-id': activeEnvironmentId ?? '' }}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div
          role="menu"
          aria-label={t('httpWorkspace.environment.selector.label')}
          data-testid="http-environment-menu"
          className="dropdown-rich absolute left-0 top-[calc(100%+0.4rem)] z-50 w-[280px]"
        >
          {option(null, t('httpWorkspace.environment.selector.none'))}
          {environments.map((env) => option(env.id, nameOf(env), env.variables.length))}
          <div className="my-1 h-px bg-border/40" role="separator" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            data-testid="http-environment-manage"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
            className={ROW}
          >
            <span className="row-icon">
              <Settings2 size={13} aria-hidden />
            </span>
            <span className="row-label">{t('httpWorkspace.environment.manage')}</span>
            <span />
          </button>
        </div>
      ) : null}
    </div>
  );
}
