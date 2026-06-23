import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, FolderTree, Globe, SquareTerminal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEnvVarsStore } from '../../stores/envVarsStore';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { traceEnvScopes } from '../../../shared/envVarScopes';
import { SettingsSection } from '../ui/SpecRow';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { EmptyState } from '../ui/EmptyState';

/**
 * RL-011 Slice C — Settings UI for the env-var tiers.
 *
 * FASE 2a (MOV.04) restructures the presentation onto the Signal-Slate
 * Settings rhythm: one `SettingsSection` (eyebrow + description) wraps
 * the three scope blocks at the `space-7` rhythm, each with its own
 * `ScopeHeading` + add-form + var rows; the genuinely-empty project/tab
 * states use the canonical `EmptyState` recipe inset; the effective-env
 * trace is promoted from a buried `<details>` into a visually
 * highlighted accent tile that reads as the payoff —
 * `tab > project > global > host shell`. All store wiring, handlers,
 * test ids, and i18n keys are preserved; only markup changed.
 *
 * The tab tier remains the most useful day-to-day knob (each tab can
 * override global vars without bleeding into other tabs) and wires
 * directly to `useEditorStore.activeTabId`; the project tier wires to
 * `useProjectStore.currentProject`.
 */
export function EnvVarsSection() {
  const { t } = useTranslation();
  const globalScope = useEnvVarsStore((state) => state.global);
  const projectScopes = useEnvVarsStore((state) => state.project);
  const tabScopes = useEnvVarsStore((state) => state.tab);
  const setGlobalVar = useEnvVarsStore((state) => state.setGlobalVar);
  const removeGlobalVar = useEnvVarsStore((state) => state.removeGlobalVar);
  const setProjectVar = useEnvVarsStore((state) => state.setProjectVar);
  const removeProjectVar = useEnvVarsStore((state) => state.removeProjectVar);
  const setTabVar = useEnvVarsStore((state) => state.setTabVar);
  const removeTabVar = useEnvVarsStore((state) => state.removeTabVar);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const currentProject = useProjectStore((state) => state.currentProject);
  const activeProjectId = currentProject?.id ?? null;

  const tabScope = activeTabId ? (tabScopes[activeTabId] ?? {}) : {};
  const projectScope = activeProjectId ? (projectScopes[activeProjectId] ?? {}) : {};

  return (
    <section id="env-vars">
      <SettingsSection
        eyebrow={t('envVars.title')}
        description={t('envVars.description')}
      >
        {/*
         * Three scopes stacked at the section's `space-7` rhythm, then
         * the highlighted effective-env tile as the payoff. Each scope is
         * its own labelled block with a `ScopeHeading`; the section
         * eyebrow names the whole tab so the scope names never duplicate
         * it.
         */}
        <div className="flex flex-col gap-7">
          <div
            className="space-y-3"
            data-testid="env-vars-global-region"
            aria-label={t('envVars.globalTitle')}
          >
            <ScopeHeading
              icon={<Globe size={14} aria-hidden="true" />}
              title={t('envVars.globalTitle')}
              description={t('envVars.global.appliesToAllHint')}
            />
            <ScopeEditor
              testidPrefix="env-vars"
              ariaRegion={t('envVars.globalTitle')}
              entries={globalScope}
              onAdd={(key, value) => setGlobalVar(key, value)}
              onRemove={(key) => removeGlobalVar(key)}
            />
            <p
              className="text-caption leading-5 text-fg-subtle"
              data-testid="env-vars-precedence-note"
            >
              {t('envVars.precedenceNote')}
            </p>
          </div>

          <ProjectScopeEditor
            activeProjectId={activeProjectId}
            projectName={currentProject?.name ?? null}
            entries={projectScope}
            onAdd={(key, value) =>
              activeProjectId ? setProjectVar(activeProjectId, key, value) : false
            }
            onRemove={(key) => {
              if (activeProjectId) removeProjectVar(activeProjectId, key);
            }}
          />

          <TabScopeEditor
            activeTabId={activeTabId}
            entries={tabScope}
            onAdd={(key, value) =>
              activeTabId ? setTabVar(activeTabId, key, value) : false
            }
            onRemove={(key) => {
              if (activeTabId) removeTabVar(activeTabId, key);
            }}
          />

          <EffectiveEnvPanel
            globalScope={globalScope}
            projectScope={projectScope}
            tabScope={tabScope}
          />
        </div>
      </SettingsSection>
    </section>
  );
}

/**
 * Per-tier label block — icon + title on the first line, supporting
 * description beneath. Mirrors the proto's `KV` heading without the
 * ad-hoc inline styles.
 */
function ScopeHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-fg-muted" aria-hidden="true">
          {icon}
        </span>
        <h4 className="text-body font-semibold text-fg-base">{title}</h4>
      </div>
      {description ? (
        <p className="text-caption leading-5 text-fg-subtle">{description}</p>
      ) : null}
    </div>
  );
}

/**
 * Maps each trace tier onto a StatusBadge tone. The badge is a state
 * marker for "which scope won": the two override tiers (tab, project)
 * read as `info`, while the baseline tiers (global, host shell) stay
 * `neutral`, so an override visually pops above the baseline.
 */
const TIER_TONE: Record<string, StatusBadgeTone> = {
  tab: 'info',
  project: 'info',
  global: 'neutral',
  processEnv: 'neutral',
};

/**
 * Highlighted effective-environment tile. FASE 2a promotes the trace
 * out of a quiet collapsed panel into an ACCENT-toned tile (primary-soft
 * surface, accent border) so it reads as the payoff of the three tiers.
 * The summary always shows the precedence chain
 * `tab > project > global > host shell` plus the resolved var count; the
 * per-key breakdown stays expandable below. `traceEnvScopes` output is
 * unchanged — each key plus the tier that won.
 */
function EffectiveEnvPanel({
  globalScope,
  projectScope,
  tabScope,
}: {
  globalScope: Record<string, string>;
  projectScope: Record<string, string>;
  tabScope: Record<string, string>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // processEnv intentionally stays empty: Slice B put the host env
  // boundary on main-process side, so the renderer trace never claims a
  // host-tier value it couldn't actually observe. Slice D will surface
  // the main-side merge separately.
  const trace = useMemo(
    () =>
      traceEnvScopes({
        processEnv: {},
        global: globalScope,
        project: projectScope,
        tab: tabScope,
      }),
    [globalScope, projectScope, tabScope]
  );

  const entries = Object.entries(trace).sort(([a], [b]) => a.localeCompare(b));

  return (
    <details
      className="overflow-hidden rounded-lg border border-accent/45 bg-primary-soft"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      data-testid="env-vars-effective"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <SquareTerminal size={15} className="shrink-0 text-accent-fg" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-body font-semibold text-accent-fg">
              {t('envVars.effectiveTitle')}
            </p>
            <p className="mt-0.5 truncate font-mono text-caption text-accent-fg/85">
              {t('envVars.precedenceChain')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-caption text-accent-fg/85">
            {t('envVars.effectiveCount', { count: entries.length })}
          </span>
          <ChevronDown
            size={14}
            className={open ? 'rotate-180 text-accent-fg transition-transform' : 'text-accent-fg transition-transform'}
            aria-hidden="true"
          />
        </div>
      </summary>
      <div className="border-t border-accent/30 px-4 py-3">
        {entries.length === 0 ? (
          <p
            className="text-caption leading-5 text-fg-subtle"
            data-testid="env-vars-effective-empty"
          >
            {t('envVars.effectiveEmpty')}
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="env-vars-effective-list">
            {entries.map(([key, record]) => (
              <li
                key={key}
                className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-bg-inset px-3 py-2"
                data-testid={`env-vars-effective-row-${key}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-body-sm font-semibold text-fg-base">{key}</span>
                  <span data-testid={`env-vars-effective-tier-${key}`}>
                    <StatusBadge tone={TIER_TONE[record.from] ?? 'neutral'}>
                      {t(`envVars.trace.tier.${record.from}`)}
                    </StatusBadge>
                  </span>
                </div>
                <span className="truncate font-mono text-caption text-fg-muted" title={record.value}>
                  {record.value === '' ? t('envVars.emptyValueDisplay') : record.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/**
 * Project-tier editor. Reads `useProjectStore.currentProject` for the
 * active projectId and falls back to the canonical empty-state recipe
 * when no project is open.
 */
function ProjectScopeEditor({
  activeProjectId,
  projectName,
  entries,
  onAdd,
  onRemove,
}: {
  activeProjectId: string | null;
  projectName: string | null;
  entries: Record<string, string>;
  onAdd: (key: string, value: string) => boolean;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3"
      data-testid="env-vars-project-region"
      aria-label={t('envVars.projectTitle')}
    >
      <ScopeHeading
        icon={<FolderTree size={14} aria-hidden="true" />}
        title={t('envVars.projectTitle')}
        description={
          projectName
            ? t('envVars.projectDescription', { project: projectName })
            : t('envVars.projectDescriptionNoProject')
        }
      />
      {activeProjectId === null ? (
        <ScopeEmpty testid="env-vars-project-no-active" message={t('envVars.noActiveProject')} />
      ) : (
        <ScopeEditor
          testidPrefix="env-vars-project"
          ariaRegion={t('envVars.projectTitle')}
          entries={entries}
          onAdd={onAdd}
          onRemove={onRemove}
          emptyMessageKey="envVars.projectEmpty"
        />
      )}
    </div>
  );
}

/**
 * Dedicated wrapper around `ScopeEditor` for the tab tier. Handles the
 * "no active tab" empty state with the canonical recipe inset.
 */
function TabScopeEditor({
  activeTabId,
  entries,
  onAdd,
  onRemove,
}: {
  activeTabId: string | null;
  entries: Record<string, string>;
  onAdd: (key: string, value: string) => boolean;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3"
      data-testid="env-vars-tab-region"
      aria-label={t('envVars.tabTitle')}
    >
      <ScopeHeading
        icon={<SquareTerminal size={14} aria-hidden="true" />}
        title={t('envVars.tabTitle')}
        description={t('envVars.tabDescription')}
      />
      {activeTabId === null ? (
        <ScopeEmpty testid="env-vars-tab-no-active" message={t('envVars.noActiveTab')} />
      ) : (
        <ScopeEditor
          testidPrefix="env-vars-tab"
          ariaRegion={t('envVars.tabTitle')}
          entries={entries}
          onAdd={onAdd}
          onRemove={onRemove}
          emptyMessageKey="envVars.tabEmpty"
        />
      )}
    </div>
  );
}

/**
 * Canonical empty-state inset for a scope that has no active target
 * (no project open / no tab focused). A dashed inset wrapping the
 * `EmptyState` recipe, matching the Plugins-tab empty pattern.
 */
function ScopeEmpty({ testid, message }: { testid: string; message: string }) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-lg border border-dashed border-border-default px-4 py-8"
      data-testid={testid}
    >
      <EmptyState
        icon={<SquareTerminal size={18} aria-hidden="true" />}
        title={t('envVars.emptyScopeTitle')}
        description={message}
      />
    </div>
  );
}

/**
 * Generic scope editor — the same form + list + remove affordance
 * reused across the global / project / tab tiers. `onAdd` returns the
 * boolean accept/reject signal from the store, so the caller doesn't
 * need to know which tier it is.
 */
function ScopeEditor({
  testidPrefix,
  ariaRegion,
  entries,
  onAdd,
  onRemove,
  emptyMessageKey = 'envVars.empty',
}: {
  testidPrefix: string;
  ariaRegion: string;
  entries: Record<string, string>;
  onAdd: (key: string, value: string) => boolean;
  onRemove: (key: string) => void;
  emptyMessageKey?: string;
}) {
  const { t } = useTranslation();
  const [keyDraft, setKeyDraft] = useState('');
  const [valueDraft, setValueDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sortedEntries = Object.entries(entries).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmedKey = keyDraft.trim();
    if (trimmedKey.length === 0) {
      setError(t('envVars.error.keyRequired'));
      return;
    }
    const accepted = onAdd(trimmedKey, valueDraft);
    if (!accepted) {
      setError(t('envVars.error.rejected'));
      return;
    }
    setKeyDraft('');
    setValueDraft('');
  };

  const handleKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setKeyDraft(event.target.value);
    if (error) setError(null);
  };

  const handleValueChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValueDraft(event.target.value);
    if (error) setError(null);
  };

  const errorId = `${testidPrefix}-error`;

  return (
    <div aria-label={ariaRegion} role="group" className="space-y-2.5">
      <form
        className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-inset px-3.5 py-3 sm:flex-row sm:items-end sm:gap-3"
        onSubmit={handleSubmit}
        data-testid={`${testidPrefix}-form`}
      >
        <label className="grid flex-1 gap-1 text-caption font-medium text-fg-base">
          <span>{t('envVars.keyLabel')}</span>
          <input
            type="text"
            className="field-shell"
            placeholder={t('envVars.keyPlaceholder')}
            value={keyDraft}
            onChange={handleKeyChange}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            data-testid={`${testidPrefix}-key-input`}
          />
        </label>
        <label className="grid flex-1 gap-1 text-caption font-medium text-fg-base">
          <span>{t('envVars.valueLabel')}</span>
          <input
            type="text"
            className="field-shell"
            placeholder={t('envVars.valuePlaceholder')}
            value={valueDraft}
            onChange={handleValueChange}
            data-testid={`${testidPrefix}-value-input`}
          />
        </label>
        <button
          type="submit"
          className="button-primary sm:h-9"
          data-testid={`${testidPrefix}-add-button`}
        >
          {t('envVars.addButton')}
        </button>
      </form>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-caption text-error"
          data-testid={`${testidPrefix}-error`}
        >
          {error}
        </p>
      )}

      {sortedEntries.length === 0 ? (
        <p
          className="rounded-lg border border-dashed border-border-default px-3.5 py-4 text-caption text-fg-subtle"
          data-testid={`${testidPrefix}-empty`}
        >
          {t(emptyMessageKey)}
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid={`${testidPrefix}-list`}>
          {sortedEntries.map(([key, value]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-inset px-3.5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-body-sm font-semibold text-fg-base">{key}</p>
                <p className="truncate font-mono text-caption text-fg-muted" title={value}>
                  {value === '' ? t('envVars.emptyValueDisplay') : value}
                </p>
              </div>
              <button
                type="button"
                className="button-secondary h-8 w-8 px-0"
                aria-label={t('envVars.removeAriaLabel', { key })}
                onClick={() => onRemove(key)}
                data-testid={`${testidPrefix}-remove-${key}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
