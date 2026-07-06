/**
 * RL-093 Slice 2 — Floating, draggable action pill.
 *
 * Replaces the centre cluster of the chrome toolbar (Run+Debug split,
 * Workflow segment, Runtime selector, New-file menu) with a single
 * floating pill positioned over the editor. The user can drag it
 * anywhere; the position persists across reloads via `useDraggable`'s
 * localStorage backing.
 *
 * Segments (left → right):
 *
 *   1. Drag handle   — ⋮⋮ button, the only region that initiates drag.
 *   2. Lang chip     — language pill + label + chevron. Click to
 *                      switch active tab's language (creates a new
 *                      tab in that language to preserve current code).
 *   3. Runtime chip  — Worker / Node / Browser preview / Deno / Bun.
 *                      Only rendered when the language has runtime modes
 *                      (JS/TS).
 *   4. Run button    — split: left fires run/debug/scratchpad; chevron
 *                      opens the workflow dropdown. Pulses with
 *                      `run-pulse` while `isRunning === true`.
 *   5. History dots  — last 5 runs from `executionHistoryStore`.
 *   6. Autosave dot  — static green indicator (Lingua saves on every
 *                      keystroke; the segment exists for design
 *                      parity until a real "autosave" setting lands).
 *
 * The pill cohabits with the existing Toolbar.tsx — when this is
 * mounted the Toolbar trims its centre cluster (sees prop
 * `showFloatingPill`). No store logic is duplicated; everything reads
 * from the same Zustand stores the Toolbar uses.
 *
 * RL-093 / T8 — the pill's segments live in sibling files
 * (`FloatingActionPill<Part>.tsx`) and its logic in
 * `useFloatingActionPill`; this file wires them together.
 */

import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { GripVertical, Settings as SettingsIcon } from 'lucide-react';
import { Tooltip } from '../ui/chrome';
import { RunHistoryDots } from '../ui/primitives';
import { cn } from '../../utils/cn';
import { useFloatingActionPill } from './useFloatingActionPill';
import { FloatingActionPillLanguageSegment } from './FloatingActionPillLanguageSegment';
import { FloatingActionPillRuntimeSegment } from './FloatingActionPillRuntimeSegment';
import { FloatingActionPillRunGroup } from './FloatingActionPillRunGroup';
import { FloatingActionPillCommandActions } from './FloatingActionPillCommandActions';

interface FloatingActionPillProps {
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  /**
   * RL-039 Slice B fold G — Opens the Recipes overlay (`Mod+Alt+L`).
   * When provided, the pill mounts a graduation-cap icon button +
   * progress badge between Utilities and Settings.
   */
  onOpenRecipes?: () => void;
  utilitiesOpen?: boolean;
  /**
   * Optional callback invoked when the user clicks the trailing
   * Settings cog (also reachable via `⌘,`). The cog is hidden when
   * no callback is provided, matching the design's "Settings shortcut
   * lives in the chrome bar" alternative.
   */
  onOpenSettings?: () => void;
}

export function FloatingActionPill({
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
  onOpenUtilities,
  onOpenRecipes,
  utilitiesOpen = false,
  onOpenSettings,
}: FloatingActionPillProps) {
  const { t } = useTranslation();
  const {
    container,
    pillRef,
    isDragging,
    cssVars,
    dragHandleProps,
    openMenu,
    setOpenMenu,
    language,
    effectiveTier,
    isWebBuild,
    handleLanguagePick,
    addNotebookTab,
    supportsRuntimeModes,
    runtimeChip,
    activeRuntimeMode,
    setTabRuntimeMode,
    currentWorkflow,
    isRunning,
    isInitializing,
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
    ensureTabForLanguage,
    setTabWorkflowMode,
    history,
    lastRunMs,
    autoSaveEnabled,
  } = useFloatingActionPill(t);

  const hasToolbarActions = Boolean(
    onOpenQuickOpen || onOpenPalette || onOpenSnippets || onOpenUtilities || onOpenRecipes
  );

  // Render via portal so the pill is positioned relative to the viewport,
  // not constrained to whatever ancestor establishes a containing block.
  if (!container) return null;

  return createPortal(
    // RL-093 review — only the drag handle gets the grab cursor.
    // The previous version applied `cursor-grab`/`cursor-grabbing` to
    // the whole pill div, which made every chip (Lang, Workflow, Run,
    // …) look draggable when only the leading handle is.
    <div
      ref={pillRef}
      data-testid="floating-action-pill"
      className={cn('action-pill fixed', isDragging && 'select-none')}
      style={{
        left: 'var(--floating-pill-x)',
        top: 'var(--floating-pill-y)',
        zIndex: 40,
        ...cssVars,
      }}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label={t('actionPill.dragHandle')}
        className="action-pill-drag-handle ml-0.5 inline-flex items-center justify-center rounded-full text-fg-subtle hover:text-fg-base"
        {...dragHandleProps}
      >
        <GripVertical size={12} aria-hidden />
      </button>

      {/* Runtime control — language · runtime · run read as ONE
          structured segmented group (Signal-Slate RuntimeSelector
          recipe): a single inset shell (rounded-lg border-border-subtle
          bg-bg-inset) with hairline `.action-pill-divider` separators
          between segments and a GREEN run segment at the end. The shell
          is NOT `overflow-hidden` so the run group's resting glow + the
          `data-running` run-pulse box-shadow still escape its bounds.
          The drag handle, meta cluster, command actions, and settings
          cog stay OUTSIDE this group — they are not part of the runtime
          control. */}
      <div className="action-pill-runtime-group inline-flex items-stretch self-stretch rounded-lg border border-border-subtle bg-bg-inset">
        {/* 1. Language chip */}
        <FloatingActionPillLanguageSegment
          language={language}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          effectiveTier={effectiveTier}
          isWebBuild={isWebBuild}
          onPickLanguage={handleLanguagePick}
          addNotebookTab={addNotebookTab}
        />

        <span className="action-pill-divider" />

        {/* RL-093 Slice 3 — runtime chip stays separate (orthogonal to
            workflow). The old "Workflow" chip + separate "Run" split
            button were merged into a single mode-aware action button at
            the end of the pill (see "Mode-aware action button" below). */}

        {/* 2. Runtime chip — "what engine": Worker / Node / Browser preview /
                Deno / Bun. Only visible for languages that have runtime modes
                (JS/TS). */}
        {supportsRuntimeModes ? (
          <FloatingActionPillRuntimeSegment
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            runtimeChip={runtimeChip}
            activeRuntimeMode={activeRuntimeMode}
            language={language}
            ensureTabForLanguage={ensureTabForLanguage}
            setTabRuntimeMode={setTabRuntimeMode}
          />
        ) : null}

        {/* 3. Mode-aware action button (RL-093 Slice 3).
                Replaces the previous "Workflow chip + separate Run
                split-button" pair. The main button:
                  · Colours itself by the active workflow (green for run,
                    red-soft for debug, accent for scratchpad).
                  · Shows that workflow's label and icon, with a kbd hint.
                  · Fires the workflow on click. When `isRunning`, fires
                    `stop()` instead (same as the previous Run button).
                The chevron opens a dropdown that LETS THE USER PICK a
                different workflow; selecting one switches the per-tab
                workflow mode AND fires it immediately, so "switch and
                run" stays a single click. */}
        <FloatingActionPillRunGroup
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          currentWorkflow={currentWorkflow}
          isRunning={isRunning}
          isInitializing={isInitializing}
          runDisabled={runDisabled}
          runDisabledTooltip={runDisabledTooltip}
          workflowChip={workflowChip}
          handleRunClick={handleRunClick}
          run={run}
          supportsDebug={supportsDebug}
          debuggerEnabled={debuggerEnabled}
          isNotebookTab={isNotebookTab}
          desktopOnlyGate={desktopOnlyGate}
          proLanguageGate={proLanguageGate}
          noActiveTab={noActiveTab}
          language={language}
          ensureTabForLanguage={ensureTabForLanguage}
          setTabWorkflowMode={setTabWorkflowMode}
        />
      </div>
      {/* end runtime segmented group (language · runtime · run) */}

      <span className="action-pill-divider action-pill-meta-divider" />

      {/* 4. History dots */}
      <div className="action-pill-meta inline-flex items-center gap-2 pl-2 pr-3 text-eyebrow font-mono text-fg-subtle">
        <span className="uppercase font-bold">{t('actionPill.runs')}</span>
        <RunHistoryDots history={history} />
        {lastRunMs !== null ? (
          <span className="text-fg-base font-medium">{lastRunMs.toFixed(1)}ms</span>
        ) : null}
      </div>

      <span className="action-pill-divider action-pill-meta-divider" />

      {/* 5. Autosave dot — Lingua persists every keystroke locally, so
              the chip is informational rather than a toggle. Surfaces
              a tooltip explaining the always-on behaviour. */}
      <Tooltip content={t('actionPill.autosaveTooltip')}>
        <div
          className="action-pill-meta inline-flex items-center gap-1.5 pl-2 pr-3 text-eyebrow font-mono text-fg-muted"
          data-testid="action-pill-autosave"
        >
          <span
            aria-hidden
            className={cn(
              'inline-block size-1.5 rounded-full',
              autoSaveEnabled ? 'bg-success-fg' : 'bg-border-strong',
            )}
          />
          <span>{t('actionPill.autosave')}</span>
        </div>
      </Tooltip>

      {hasToolbarActions ? (
        <FloatingActionPillCommandActions
          onOpenPalette={onOpenPalette}
          onOpenQuickOpen={onOpenQuickOpen}
          onOpenSnippets={onOpenSnippets}
          onOpenUtilities={onOpenUtilities}
          onOpenRecipes={onOpenRecipes}
          utilitiesOpen={utilitiesOpen}
          onCloseMenu={() => setOpenMenu(null)}
        />
      ) : null}

      {/* RL-039 Slice B fold G — Recipes badge button. Rendered as a
              sibling component so the lessonProgressStore subscription
              stays scoped (no parent re-render storms). */}
      {/* 6. Settings cog — opens the Settings modal. Only mounted when
              the consumer wired `onOpenSettings`. */}
      {onOpenSettings ? (
        <>
          <span className="action-pill-divider" />
          <Tooltip content={t('actionPill.settingsTooltip')}>
            <button
              type="button"
              aria-label={t('actionPill.settingsTooltip')}
              data-testid="action-pill-settings"
              onClick={() => {
                setOpenMenu(null);
                onOpenSettings();
              }}
              className="action-pill-segment ml-0.5 mr-0.5 px-2 text-fg-subtle hover:text-fg-base"
            >
              <SettingsIcon size={12} aria-hidden />
            </button>
          </Tooltip>
        </>
      ) : null}
    </div>,
    container,
  );
}
