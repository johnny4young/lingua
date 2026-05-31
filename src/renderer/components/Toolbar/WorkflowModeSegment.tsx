import { useRef } from 'react';
import { Bug, Play, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  WORKFLOW_MODES,
  defaultWorkflowMode,
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../../shared/workflowMode';
import { Tooltip } from '../ui/chrome';
import { cn } from '../../utils/cn';

/**
 * RL-020 Slice 2 — per-tab workflow-mode segmented control.
 *
 * Renders three segments — Run / Debug / Scratchpad — next to the
 * existing Run button. The active tab's mode is highlighted; segments
 * the active tab's language does not support are visually disabled
 * with a hover tooltip explaining why.
 *
 * Layout:
 *
 *   - Mode segments are <button>s inside a `role="group"` container
 *     with arrow-key navigation. Fold E — arrow keys SKIP disabled
 *     segments instead of stopping on them so keyboard users never
 *     land on a no-op slot.
 *
 *   - When the active tab has only one supported mode (e.g. a
 *     plain-text tab where only `run` is valid) the group collapses
 *     to a single label-only pill — the segmented control would be
 *     a visual no-op.
 *
 * Behaviour:
 *
 *   - Click an enabled, non-active segment → calls
 *     `setTabWorkflowMode` which fires
 *     `runtime.workflow_mode_changed` telemetry and surfaces a
 *     status-notice confirming the switch.
 *
 *   - Click a disabled segment → noop; the tooltip already explains
 *     when the mode lands.
 *
 *   - Fold F — first time the user switches AWAY from Scratchpad,
 *     `editorStore.setTabWorkflowMode` surfaces a one-shot status
 *     notice explaining the modes. Centralizing it in the store keeps
 *     toolbar clicks and the keyboard cycle consistent.
 */

const MODE_LABEL_KEY: Record<WorkflowMode, string> = {
  run: 'workflowMode.run.label',
  debug: 'workflowMode.debug.label',
  scratchpad: 'workflowMode.scratchpad.label',
};

const MODE_ICON: Record<WorkflowMode, typeof Play> = {
  run: Play,
  debug: Bug,
  scratchpad: Sparkles,
};

const MODE_UNSUPPORTED_HINT_KEY: Record<WorkflowMode, string> = {
  // Run is always supported, so this never reads — kept for the
  // closed-record contract.
  run: 'workflowMode.unsupportedReason.run',
  debug: 'workflowMode.unsupportedReason.debug',
  scratchpad: 'workflowMode.unsupportedReason.scratchpad',
};

export function WorkflowModeSegment() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const tabs = useEditorStore((state) => state.tabs);
  const setTabWorkflowMode = useEditorStore((state) => state.setTabWorkflowMode);
  const groupRef = useRef<HTMLDivElement | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) return null;

  const language = activeTab.language;
  const currentMode: WorkflowMode =
    activeTab.workflowMode ?? defaultWorkflowMode(language);

  // Collapse-to-label when only one mode is supported. Avoids
  // showing a 3-segment control where 2 are permanently disabled
  // (e.g. plain-text tab).
  const supportedModes = WORKFLOW_MODES.filter((mode) =>
    supportsWorkflowMode(language, mode)
  );
  if (supportedModes.length <= 1) {
    const onlyMode = supportedModes[0] ?? 'run';
    return (
      <Tooltip content={t('workflowMode.toggle.description')}>
        <span
          data-testid="workflow-mode-segment-collapsed"
          data-workflow-mode={onlyMode}
          className="status-pill rounded-lg border-border-subtle bg-bg-inset px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-fg-subtle"
        >
          {t(MODE_LABEL_KEY[onlyMode])}
        </span>
      </Tooltip>
    );
  }

  const handleSelect = (mode: WorkflowMode) => {
    if (!supportsWorkflowMode(language, mode)) return;
    if (mode === currentMode) return;
    setTabWorkflowMode(activeTab.id, mode);
  };

  // Fold E — arrow-key navigation that SKIPS disabled segments.
  // Tab still moves focus to the next focusable element outside the
  // group; arrows cycle inside the supported subset.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const idx = supportedModes.indexOf(currentMode);
    if (idx < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? supportedModes[(idx + 1) % supportedModes.length]!
        : supportedModes[(idx - 1 + supportedModes.length) % supportedModes.length]!;
    if (next === currentMode) return;
    handleSelect(next);
    // Move focus to the freshly selected segment so the keyboard
    // user has a clear focus signal.
    requestAnimationFrame(() => {
      const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-workflow-segment]'
      );
      buttons?.forEach((btn) => {
        if (btn.dataset.workflowSegment === next) btn.focus();
      });
    });
  };

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={t('workflowMode.toggle.description')}
      data-testid="workflow-mode-segment"
      data-workflow-mode={currentMode}
      onKeyDown={handleKeyDown}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border-subtle bg-bg-inset p-0.5 text-[0.7rem] font-semibold tracking-[0.02em] text-fg-base"
    >
      {WORKFLOW_MODES.map((mode) => {
        const Icon = MODE_ICON[mode];
        const supported = supportsWorkflowMode(language, mode);
        const active = mode === currentMode;
        const labelText = t(MODE_LABEL_KEY[mode]);
        const hintText = !supported
          ? t(MODE_UNSUPPORTED_HINT_KEY[mode])
          : undefined;
        return (
          <button
            key={mode}
            type="button"
            data-workflow-segment={mode}
            data-testid={`workflow-mode-segment-${mode}`}
            aria-pressed={active}
            aria-disabled={!supported}
            title={hintText}
            tabIndex={active ? 0 : -1}
            onClick={() => handleSelect(mode)}
            className={cn(
              'inline-flex items-center gap-1 rounded-[5px] px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset',
              supported
                ? active
                  ? 'bg-bg-panel-alt font-semibold text-fg-base'
                  : 'text-fg-base hover:bg-bg-panel-alt'
                : 'cursor-not-allowed text-fg-subtle opacity-60'
            )}
          >
            <Icon size={12} aria-hidden="true" />
            <span>{labelText}</span>
          </button>
        );
      })}
    </div>
  );
}
