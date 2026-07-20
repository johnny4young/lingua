/**
 * internal / implementation — Mode-aware action button + workflow picker for the
 * floating action pill. The main button fires the active workflow (or
 * stops a running task); the chevron opens a dropdown that switches the
 * per-tab workflow AND fires it in one click. Extracted verbatim.
 */

import type { ReactNode } from 'react';
import {
  formatBootstrapProgress,
  useBootstrapProgressStore,
} from '../../stores/bootstrapProgressStore';
import { getInitializationMessage } from '../../hooks/runnerOutput';
import { useTranslation } from 'react-i18next';
import { Bug, ChevronDown, Loader2, Play, Sparkles } from 'lucide-react';
import type { EditorState, FileTab, Language } from '../../types';
import type { WorkflowMode } from '../../../shared/workflowMode';
import type { RunOptions } from '../../hooks/useRunner';
import { Kbd } from '../ui/chrome';
import { MonoBadge } from '../ui/primitives';
import type { ActionPillMenu, ActionPillMenuSetter } from './useFloatingActionPill';

interface RunGroupProps {
  openMenu: ActionPillMenu | null;
  setOpenMenu: ActionPillMenuSetter;
  currentWorkflow: WorkflowMode;
  isRunning: boolean;
  isInitializing: boolean;
  /** internal — live bootstrap text (static message or MB counter). */
  loadingMessage: string | null;
  runDisabled: boolean;
  runDisabledTooltip: string | undefined;
  workflowChip: { icon: ReactNode; label: string };
  handleRunClick: () => void;
  run: (options?: RunOptions) => unknown;
  supportsDebug: boolean;
  debuggerEnabled: boolean;
  isNotebookTab: boolean;
  desktopOnlyGate: boolean;
  proLanguageGate: boolean;
  noActiveTab: boolean;
  language: Language;
  ensureTabForLanguage: (lang: Language) => FileTab;
  setTabWorkflowMode: EditorState['setTabWorkflowMode'];
}

export function FloatingActionPillRunGroup({
  openMenu,
  setOpenMenu,
  currentWorkflow,
  isRunning,
  isInitializing,
  loadingMessage,
  runDisabled,
  runDisabledTooltip,
  workflowChip,
  handleRunClick,
  run,
  supportsDebug,
  debuggerEnabled,
  isNotebookTab,
  desktopOnlyGate,
  proLanguageGate,
  noActiveTab,
  language,
  ensureTabForLanguage,
  setTabWorkflowMode,
}: RunGroupProps) {
  const { t } = useTranslation();
  // internal — live runtime-bootstrap progress, path-agnostic: the
  // store is fed by the worker whether the boot started from a manual
  // run's initialization window OR the scratchpad auto-run, so the
  // pill shows the download counter either way.
  const bootstrapProgress = useBootstrapProgressStore(state =>
    state.progress?.language === language ? state.progress : null
  );
  const bootstrapLabel = bootstrapProgress
    ? formatBootstrapProgress(
        getInitializationMessage(bootstrapProgress.language),
        bootstrapProgress
      )
    : null;

  return (
    <div
      className="action-pill-run-group relative inline-flex items-stretch"
      data-workflow={currentWorkflow}
    >
      <button
        type="button"
        onClick={handleRunClick}
        disabled={runDisabled}
        data-running={isRunning ? 'true' : 'false'}
        data-workflow={currentWorkflow}
        data-testid="action-pill-run"
        aria-label={workflowChip.label}
        title={runDisabledTooltip}
        className="action-pill-run action-pill-run-main rounded-l-none"
      >
        {bootstrapLabel !== null || isInitializing || isRunning ? (
          <Loader2 size={11} className="animate-spin" aria-hidden />
        ) : (
          <span aria-hidden>{workflowChip.icon}</span>
        )}
        <span className="max-w-[260px] truncate">
          {bootstrapLabel ??
            (isInitializing && loadingMessage
              ? loadingMessage
              : isRunning
                ? t('actionPill.running')
                : workflowChip.label)}
        </span>
        {!isRunning ? <Kbd>⌘⏎</Kbd> : null}
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={openMenu === 'run'}
        aria-label={t('actionPill.workflowMenu')}
        data-workflow={currentWorkflow}
        data-testid="action-pill-run-menu"
        className="action-pill-run action-pill-run-menu rounded-r-lg"
        onClick={() => setOpenMenu(openMenu === 'run' ? null : 'run')}
      >
        <ChevronDown size={11} aria-hidden />
      </button>
      {openMenu === 'run' ? (
        <div className="dropdown-rich absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[320px]" role="menu">
          {(
            [
              {
                k: 'run',
                icon: <Play size={13} />,
                label: t('actionPill.run'),
                desc: t('actionPill.workflow.run'),
                kbd: '⌘⏎',
                disabled: runDisabled,
                fire: () => void run(),
              },
              {
                k: 'debug',
                icon: <Bug size={13} />,
                label: t('toolbar.debug.label'),
                desc: t('actionPill.workflow.debug'),
                kbd: '⌥⏎',
                disabled: runDisabled || !supportsDebug || !debuggerEnabled,
                fire: () => void run({ debug: true }),
              },
              {
                k: 'scratchpad',
                icon: <Sparkles size={13} />,
                label: t('workflowMode.scratchpad.label'),
                desc: t('actionPill.workflow.scratchpad'),
                kbd: null as string | null,
                disabled: isNotebookTab || desktopOnlyGate || proLanguageGate,
                fire: () => undefined,
              },
            ] as const
          ).map((item) => {
            const isActive = currentWorkflow === item.k;
            return (
              <button
                key={item.k}
                type="button"
                role="menuitem"
                className="dropdown-rich-row w-full disabled:opacity-45 disabled:cursor-not-allowed"
                data-active={isActive ? 'true' : 'false'}
                data-workflow={item.k}
                data-testid={`action-pill-workflow-option-${item.k}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpenMenu(null);
                  if (item.disabled) return;
                  // internal follow-up — same fallback as the
                  // Runtime chip: create a tab in the chip's
                  // current language if there's none so the
                  // workflow picker always advances the user.
                  const target = ensureTabForLanguage(language);
                  if (target.workflowMode !== item.k) {
                    setTabWorkflowMode(target.id, item.k as WorkflowMode);
                  }
                  // Switching INTO scratchpad doesn't fire a manual
                  // run (scratchpad re-evaluates automatically as
                  // the user edits). Run / Debug fire the action so
                  // "switch + run" stays one click — but only when
                  // we already had a real tab; a freshly-created
                  // tab is empty so firing would just log "nothing
                  // to run".
                  if (item.k !== 'scratchpad' && !noActiveTab) {
                    item.fire();
                  }
                }}
              >
                <span className="row-icon self-start mt-0.5">{item.icon}</span>
                <span>
                  <span className="row-label block">{item.label}</span>
                  <span className="row-desc block">{item.desc}</span>
                </span>
                {item.kbd ? (
                  <MonoBadge tone="accent">{item.kbd}</MonoBadge>
                ) : isActive ? (
                  <MonoBadge tone="accent">{t('actionPill.badgeActive')}</MonoBadge>
                ) : (
                  <span />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
