import { isLanguageAllowed } from '../../../shared/entitlements';
import type { LicenseTier } from '../../../shared/license';
import {
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../../shared/workflowMode';
import type { Language } from '../../types/language';
import {
  executionModeForLanguage,
  languageCapabilityBadgeKey,
} from '../../utils/languageMeta';

export type ExecutionControlDisabledReason =
  | 'desktop-only'
  | 'no-enabled-breakpoint'
  | 'notebook'
  | 'pro-only'
  | 'unsupported-workflow'
  | 'view-only';

interface ExecutionActionAvailability {
  disabled: boolean;
  reason: ExecutionControlDisabledReason | null;
}

export interface ExecutionControlPolicy {
  executionMode: ReturnType<typeof executionModeForLanguage>;
  desktopOnlyGate: boolean;
  proLanguageGate: boolean;
  supportsDebug: boolean;
  actions: Record<WorkflowMode, ExecutionActionAvailability>;
}

interface ExecutionControlPolicyInput {
  language: Language;
  effectiveTier: LicenseTier;
  isWebBuild: boolean;
  isNotebookTab: boolean;
  enabledBreakpointCount: number;
}

function availability(
  reason: ExecutionControlDisabledReason | null,
): ExecutionActionAvailability {
  return { disabled: reason !== null, reason };
}

/**
 * Pure capability policy shared by every shell execution control.
 *
 * Surface-specific interaction stays with the caller: the compact toolbar
 * disables its primary action while a separate Stop button is visible, while
 * the floating pill keeps its primary action enabled so the same button can
 * stop a running task. This model owns only product eligibility.
 */
export function resolveExecutionControlPolicy({
  language,
  effectiveTier,
  isWebBuild,
  isNotebookTab,
  enabledBreakpointCount,
}: ExecutionControlPolicyInput): ExecutionControlPolicy {
  const executionMode = executionModeForLanguage(language);
  const proLanguageGate =
    executionMode === 'run' && !isLanguageAllowed(effectiveTier, language);
  const desktopOnlyGate =
    !proLanguageGate &&
    isWebBuild &&
    executionMode === 'run' &&
    languageCapabilityBadgeKey(language) === 'language.capability.desktopOnly';
  const sharedReason: ExecutionControlDisabledReason | null = isNotebookTab
    ? 'notebook'
    : proLanguageGate
      ? 'pro-only'
      : desktopOnlyGate
        ? 'desktop-only'
        : executionMode === 'view'
          ? 'view-only'
          : null;
  const supportsDebug = supportsWorkflowMode(language, 'debug');
  const debugReason =
    sharedReason ??
    (!supportsDebug
      ? 'unsupported-workflow'
      : enabledBreakpointCount === 0
        ? 'no-enabled-breakpoint'
        : null);
  const scratchpadReason =
    sharedReason ??
    (supportsWorkflowMode(language, 'scratchpad')
      ? null
      : 'unsupported-workflow');

  return {
    executionMode,
    desktopOnlyGate,
    proLanguageGate,
    supportsDebug,
    actions: {
      run: availability(sharedReason),
      debug: availability(debugReason),
      scratchpad: availability(scratchpadReason),
    },
  };
}

/**
 * Translation key for a disabled execution action.
 *
 * Returning the key instead of translated copy keeps the policy deterministic
 * and lets each surface translate at render time.
 */
export function executionDisabledTooltipKey(
  workflow: WorkflowMode,
  reason: ExecutionControlDisabledReason | null,
): string | undefined {
  if (reason === null) return undefined;
  if (reason === 'pro-only') return 'toolbar.run.proOnlyTooltip';
  if (reason === 'desktop-only') return 'toolbar.run.desktopOnlyTooltip';
  if (reason === 'view-only') return 'toolbar.viewOnly.title';
  if (reason === 'notebook') return 'notebook.notice.useNotebookToolbar';
  if (reason === 'no-enabled-breakpoint') return 'toolbar.debug.noBreakpoint';
  return `workflowMode.unsupportedReason.${workflow}`;
}
