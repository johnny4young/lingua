import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEnvVarsStore } from '../../stores/envVarsStore';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { traceEnvScopes } from '../../../shared/envVarScopes';
import { Section } from './shared';

/**
 * RL-011 Slice C — Settings UI for the env-var tiers.
 *
 * Slice C second increment (2026-04-20 bis) adds the tab-tier editor on
 * top of the existing global editor. The tab tier is the most useful
 * day-to-day knob (each tab can override global vars without bleeding
 * into other tabs) and wires directly to `useEditorStore.activeTabId`.
 *
 * Project-tier editor and the effective-env trace panel land in the
 * third increment (Slice C step 5). The shared precedence note already
 * mentions all three tiers so the user isn't surprised.
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
    <Section
      id="env-vars"
      title={t('envVars.title')}
      description={t('envVars.description')}
    >
      <div
        className="space-y-2"
        data-testid="env-vars-global-region"
        aria-label={t('envVars.globalTitle')}
      >
        <h4 className="text-sm font-semibold text-foreground">
          {t('envVars.globalTitle')}
        </h4>
        <ScopeEditor
          testidPrefix="env-vars"
          ariaRegion={t('envVars.globalTitle')}
          entries={globalScope}
          onAdd={(key, value) => setGlobalVar(key, value)}
          onRemove={(key) => removeGlobalVar(key)}
        />
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

      <p className="text-xs text-muted" data-testid="env-vars-precedence-note">
        {t('envVars.precedenceNote')}
      </p>

      <EffectiveEnvPanel
        globalScope={globalScope}
        projectScope={projectScope}
        tabScope={tabScope}
      />
    </Section>
  );
}

/**
 * Collapsible panel that renders `traceEnvScopes` output — each key in
 * the merged env plus the tier that won. Closed by default so it doesn't
 * crowd the Settings card; opens on explicit user request.
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
      className="rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-2.5"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      data-testid="env-vars-effective"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs font-semibold text-foreground">
        <span>{t('envVars.effectiveTitle')}</span>
        <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </summary>
      {entries.length === 0 ? (
        <p
          className="pt-2 text-xs text-muted"
          data-testid="env-vars-effective-empty"
        >
          {t('envVars.effectiveEmpty')}
        </p>
      ) : (
        <ul className="mt-2 space-y-1" data-testid="env-vars-effective-list">
          {entries.map(([key, record]) => (
            <li
              key={key}
              className="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs"
              data-testid={`env-vars-effective-row-${key}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-foreground">{key}</span>
                <span
                  className="status-pill border-border/60 bg-transparent px-2 text-[0.65rem] text-muted"
                  data-testid={`env-vars-effective-tier-${key}`}
                >
                  {t(`envVars.trace.tier.${record.from}`)}
                </span>
              </div>
              <span className="truncate font-mono text-muted" title={record.value}>
                {record.value === '' ? t('envVars.emptyValueDisplay') : record.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * Project-tier editor. Reads `useProjectStore.currentProject` for the
 * active projectId and falls back to a placeholder when no project is
 * open.
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
      className="mt-4 space-y-2"
      data-testid="env-vars-project-region"
      aria-label={t('envVars.projectTitle')}
    >
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground">
          {t('envVars.projectTitle')}
        </h4>
        <p className="text-xs leading-5 text-muted">
          {projectName
            ? t('envVars.projectDescription', { project: projectName })
            : t('envVars.projectDescriptionNoProject')}
        </p>
      </div>
      {activeProjectId === null ? (
        <p
          className="rounded-[1.15rem] border border-dashed border-border/60 bg-transparent px-3.5 py-4 text-xs text-muted"
          data-testid="env-vars-project-no-active"
        >
          {t('envVars.noActiveProject')}
        </p>
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
 * "no active tab" empty state without cluttering the parent component.
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
      className="mt-4 space-y-2"
      data-testid="env-vars-tab-region"
      aria-label={t('envVars.tabTitle')}
    >
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground">
          {t('envVars.tabTitle')}
        </h4>
        <p className="text-xs leading-5 text-muted">
          {t('envVars.tabDescription')}
        </p>
      </div>
      {activeTabId === null ? (
        <p
          className="rounded-[1.15rem] border border-dashed border-border/60 bg-transparent px-3.5 py-4 text-xs text-muted"
          data-testid="env-vars-tab-no-active"
        >
          {t('envVars.noActiveTab')}
        </p>
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
    <div aria-label={ariaRegion} role="group" className="space-y-2">
      <form
        className="flex flex-col gap-2 rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-3 sm:flex-row sm:items-end sm:gap-3"
        onSubmit={handleSubmit}
        data-testid={`${testidPrefix}-form`}
      >
        <label className="grid flex-1 gap-1 text-xs font-medium text-foreground">
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
        <label className="grid flex-1 gap-1 text-xs font-medium text-foreground">
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
          className="text-xs text-error"
          data-testid={`${testidPrefix}-error`}
        >
          {error}
        </p>
      )}

      {sortedEntries.length === 0 ? (
        <p
          className="rounded-[1.15rem] border border-dashed border-border/60 bg-transparent px-3.5 py-4 text-xs text-muted"
          data-testid={`${testidPrefix}-empty`}
        >
          {t(emptyMessageKey)}
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid={`${testidPrefix}-list`}>
          {sortedEntries.map(([key, value]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-2.5 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono font-semibold text-foreground">{key}</p>
                <p className="truncate font-mono text-muted" title={value}>
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
