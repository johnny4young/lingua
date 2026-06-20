import { useTranslation } from 'react-i18next';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceSqlStore } from '../../stores/workspaceSqlStore';
import { trackEvent } from '../../utils/telemetry';
import { trackSqlStorageMode } from '../../hooks/sqlWorkspaceTelemetry';
import {
  clearPersistedSqlDatabase,
  configureDuckDbPersistence,
  flushAndReleaseDuckDbEngine,
  getDuckDbEngine,
  getResolvedSqlStorageMode,
  getResolvedSqlStorageRequestMode,
  isOpfsStorageAvailable,
} from '../../runtime/duckdbClient';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import {
  DEFAULT_FONT_FAMILY,
  EDITOR_THEMES,
  FONT_FAMILIES,
  FONT_SIZES,
} from './settingsOptions';
import { Select, StepperButton, Toggle } from './shared';
import { SpecCard, SpecRow, SettingsSection } from '../ui/SpecRow';
import { languageLabel } from '../../utils/languageMeta';
import { ThemePresetControls } from './ThemePresetControls';
import {
  RUNTIME_MODES,
  isRuntimeModeImplemented,
  type RuntimeMode,
} from '../../../shared/runtimeModes';
import {
  WORKFLOW_MODES,
  defaultWorkflowMode,
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../../shared/workflowMode';
import {
  RUNTIME_TIMEOUT_PRESETS,
  RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES,
  defaultRuntimeTimeoutPreset,
  type RuntimeTimeoutPreset,
} from '../../../shared/runtimeTimeoutPresets';

/**
 * RL-097 Slice 3 fold D — SQL query timeout presets (milliseconds). The
 * setter clamps to [1s, 5min]; these are the surfaced choices. The label
 * key per preset lives in `settings.editor.sqlWorkspace.queryTimeout.*`.
 */
const SQL_QUERY_TIMEOUT_PRESETS: ReadonlyArray<{
  ms: number;
  labelKey: string;
}> = [
  { ms: 5_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option5s' },
  { ms: 15_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option15s' },
  { ms: 30_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option30s' },
  { ms: 60_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option60s' },
  { ms: 300_000, labelKey: 'settings.editor.sqlWorkspace.queryTimeout.option5m' },
];

const SQL_ROW_DISPLAY_LIMITS: ReadonlyArray<100 | 500 | 1000 | 5000> = [
  100, 500, 1000, 5000,
];

export function EditorSection() {
  const effectiveTier = useEffectiveTier();
  const canUseExtendedFonts = useEntitlement('FONT_PACK_EXTENDED');
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const setEditorTheme = useSettingsStore((state) => state.setEditorTheme);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const setFontFamily = useSettingsStore((state) => state.setFontFamily);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setFontSize = useSettingsStore((state) => state.setFontSize);
  const wordWrap = useSettingsStore((state) => state.wordWrap);
  const toggleWordWrap = useSettingsStore((state) => state.toggleWordWrap);
  const minimap = useSettingsStore((state) => state.minimap);
  const toggleMinimap = useSettingsStore((state) => state.toggleMinimap);
  const maxLoopIterations = useSettingsStore((state) => state.maxLoopIterations);
  const setMaxLoopIterations = useSettingsStore((state) => state.setMaxLoopIterations);
  const restoreSessionMode = useSettingsStore((state) => state.restoreSessionMode);
  const setRestoreSessionMode = useSettingsStore((state) => state.setRestoreSessionMode);
  const formatOnSave = useSettingsStore((state) => state.formatOnSave);
  const toggleFormatOnSave = useSettingsStore((state) => state.toggleFormatOnSave);
  const smartPasteDetectionEnabled = useSettingsStore(
    (state) => state.smartPasteDetectionEnabled
  );
  const toggleSmartPasteDetection = useSettingsStore(
    (state) => state.toggleSmartPasteDetection
  );
  const vimMode = useSettingsStore((state) => state.vimMode);
  const toggleVimMode = useSettingsStore((state) => state.toggleVimMode);
  const defaultRuntimeMode = useSettingsStore((state) => state.defaultRuntimeMode);
  const setDefaultRuntimeMode = useSettingsStore((state) => state.setDefaultRuntimeMode);
  const notebookDefaultCellLanguage = useSettingsStore(
    (state) => state.notebookDefaultCellLanguage
  );
  const setNotebookDefaultCellLanguage = useSettingsStore(
    (state) => state.setNotebookDefaultCellLanguage
  );
  const workflowModeDefaultsByLanguage = useSettingsStore(
    (state) => state.workflowModeDefaultsByLanguage
  );
  const setWorkflowModeDefault = useSettingsStore(
    (state) => state.setWorkflowModeDefault
  );
  const scratchpadAutoLogByLanguage = useSettingsStore(
    (state) => state.scratchpadAutoLogByLanguage
  );
  const setScratchpadAutoLogDefault = useSettingsStore(
    (state) => state.setScratchpadAutoLogDefault
  );
  // RL-108 — inline lint is stored + surfaced per language, so adding a
  // language's lint in a later slice lights up a new row without a re-layout.
  const inlineLintEnabledByLanguage = useSettingsStore(
    (state) => state.inlineLintEnabledByLanguage
  );
  const setInlineLintEnabled = useSettingsStore((state) => state.setInlineLintEnabled);
  const showStdinPanel = useSettingsStore((state) => state.showStdinPanel);
  const toggleShowStdinPanel = useSettingsStore((state) => state.toggleShowStdinPanel);
  // RL-112 — master visibility toggle for the persistent bottom status bar.
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  const setShowStatusBar = useSettingsStore((state) => state.setShowStatusBar);
  const variableInspectorSurface = useSettingsStore(
    (state) => state.variableInspectorSurface
  );
  const setVariableInspectorSurface = useSettingsStore(
    (state) => state.setVariableInspectorSurface
  );
  const runtimeTimeoutPresetByLanguage = useSettingsStore(
    (state) => state.runtimeTimeoutPresetByLanguage
  );
  const setRuntimeTimeoutPreset = useSettingsStore(
    (state) => state.setRuntimeTimeoutPreset
  );
  const showTimeoutCountdown = useSettingsStore(
    (state) => state.showTimeoutCountdown
  );
  const toggleShowTimeoutCountdown = useSettingsStore(
    (state) => state.toggleShowTimeoutCountdown
  );
  const executionHistorySnapshotEnabled = useSettingsStore(
    (state) => state.executionHistorySnapshotEnabled
  );
  const toggleExecutionHistorySnapshot = useSettingsStore(
    (state) => state.toggleExecutionHistorySnapshot
  );
  // RL-025 Slice A — dependency detection master switch.
  const dependencyDetectionEnabled = useSettingsStore(
    (state) => state.dependencyDetectionEnabled
  );
  const toggleDependencyDetectionEnabled = useSettingsStore(
    (state) => state.toggleDependencyDetectionEnabled
  );
  // RL-097 Slice 3 fold D — SQL workspace result-grid + execution
  // defaults. The settings + clamped setters already exist (Slice 2);
  // this section just surfaces them.
  const sqlWorkspaceRowDisplayLimit = useSettingsStore(
    (state) => state.sqlWorkspaceRowDisplayLimit
  );
  const setSqlWorkspaceRowDisplayLimit = useSettingsStore(
    (state) => state.setSqlWorkspaceRowDisplayLimit
  );
  const sqlWorkspaceQueryTimeoutMs = useSettingsStore(
    (state) => state.sqlWorkspaceQueryTimeoutMs
  );
  const setSqlWorkspaceQueryTimeoutMs = useSettingsStore(
    (state) => state.setSqlWorkspaceQueryTimeoutMs
  );
  // RL-097 Slice 3 (SQL OPFS) — table-persistence toggle + actions.
  const sqlWorkspacePersistTables = useSettingsStore(
    (state) => state.sqlWorkspacePersistTables
  );
  const setSqlWorkspacePersistTables = useSettingsStore(
    (state) => state.setSqlWorkspacePersistTables
  );
  const { t } = useTranslation();
  // Slice 2 — ligatures auto-enable when the active font supports them.
  // Settings → Editor no longer surfaces a toggle.
  const ligaturesAvailable = true;

  const handleExecutionHistorySnapshotUnlock = () => {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: t('upsell.feature.executionHistory'),
    });
    void trackEvent('feature.blocked', {
      entitlement: 'execution-history',
      tier: effectiveTier,
    });
  };

  // RL-097 Slice 3 (SQL OPFS) — whether this browser exposes OPFS at
  // all. When false the toggle still works (the runtime falls back to
  // in-memory + notifies) but we surface an inline note so the user
  // understands persistence won't take.
  const opfsAvailable = isOpfsStorageAvailable();

  // RL-097 Slice 3 (SQL OPFS) fold E — delete the persisted database.
  // Destructive (drops every saved table + row), so it confirms first.
  // `clearPersistedSqlDatabase` terminates the engine before removing
  // the OPFS file. Reconnect immediately afterwards so the SQL panel chip
  // reflects the fresh backing instead of staying stale until the next run.
  const handleClearSqlData = () => {
    if (
      !window.confirm(
        t('settings.editor.sqlWorkspace.persistTables.clearConfirm')
      )
    ) {
      return;
    }
    void (async () => {
      await clearPersistedSqlDatabase();
      configureDuckDbPersistence(sqlWorkspacePersistTables);
      try {
        await getDuckDbEngine();
      } catch (err) {
        useUIStore.getState().pushStatusNotice({
          tone: 'warning',
          messageKey: 'sqlWorkspace.response.engineLoadFailedBand',
          detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
        });
        return;
      }
      const resolved = getResolvedSqlStorageMode();
      const requested = getResolvedSqlStorageRequestMode();
      useWorkspaceSqlStore.getState().setStorageMode(resolved, requested);
      trackSqlStorageMode(resolved, requested);
      const fellBack = requested === 'opfs' && resolved === 'memory';
      useUIStore.getState().pushStatusNotice({
        tone: fellBack ? 'warning' : 'success',
        messageKey: fellBack
          ? 'sqlWorkspace.storage.unavailableNotice'
          : 'settings.editor.sqlWorkspace.persistTables.cleared',
      });
    })();
  };

  // RL-097 Slice 3 (SQL OPFS) fold E — apply the persistence toggle to
  // the live engine without a full reload. Terminating drops the current
  // session's in-memory tables, so it confirms first. Re-instantiates,
  // records the resolved mode (chip updates live), and fires the
  // storage-mode telemetry for the new resolution.
  const handleReconnectSql = () => {
    if (
      !window.confirm(
        t('settings.editor.sqlWorkspace.persistTables.reconnectConfirm')
      )
    ) {
      return;
    }
    void (async () => {
      await flushAndReleaseDuckDbEngine();
      configureDuckDbPersistence(sqlWorkspacePersistTables);
      try {
        await getDuckDbEngine();
      } catch (err) {
        useUIStore.getState().pushStatusNotice({
          tone: 'warning',
          messageKey: 'sqlWorkspace.response.engineLoadFailedBand',
          detail: err instanceof Error ? err.message : String(err ?? 'unknown'),
        });
        return;
      }
      const resolved = getResolvedSqlStorageMode();
      const requested = getResolvedSqlStorageRequestMode();
      useWorkspaceSqlStore.getState().setStorageMode(resolved, requested);
      trackSqlStorageMode(resolved, requested);
      const fellBack = requested === 'opfs' && resolved === 'memory';
      useUIStore.getState().pushStatusNotice({
        tone: fellBack ? 'warning' : 'success',
        messageKey: fellBack
          ? 'sqlWorkspace.storage.unavailableNotice'
          : 'settings.editor.sqlWorkspace.persistTables.reconnected',
      });
    })();
  };

  const handleFontFamilyChange = (nextFontFamily: string) => {
    const isExtendedFont = nextFontFamily !== DEFAULT_FONT_FAMILY;
    if (isExtendedFont && !canUseExtendedFonts) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: t('upsell.feature.fontPacks'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'font-packs',
        tier: effectiveTier,
      });
      return;
    }
    setFontFamily(nextFontFamily);
  };

  const formatFontOptionLabel = (font: (typeof FONT_FAMILIES)[number]) => {
    const baseLabel = font.supportsLigatures
      ? t('editor.fontFamily.optionWithLigatures', { name: font.label })
      : font.label;
    return font.value === DEFAULT_FONT_FAMILY || canUseExtendedFonts
      ? baseLabel
      : `${baseLabel} · ${t('license.badge.pro')}`;
  };

  return (
    // Editor + ThemePreset render as two sibling SettingsSections. The
    // gap matches the modal-level section rhythm (SettingsModal wraps the
    // editor tab's sections in the same spacing scale).
    <div className="space-y-6">
      <SettingsSection eyebrow={t('editor.title')} description={t('editor.description')}>
      {/* FIELDS card — each option keeps its place as a spec row whose
          Select/Stepper control sits on the right. The font preview
          stays directly under the font-family row inside its cell. */}
      <SpecCard>
        <SpecRow
          label={t('editor.theme.label')}
          description={t('editor.theme.hint')}
          control={
            <Select
              value={editorTheme}
              onChange={(event) => setEditorTheme(event.target.value)}
              aria-label={t('editor.theme.label')}
            >
              {EDITOR_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </Select>
          }
        />

        <SpecRow
          label={t('editor.fontFamily.label')}
          description={t('editor.fontFamily.hint')}
          control={
            <div className="grid w-72 gap-2">
              <Select
                value={fontFamily}
                onChange={(event) => handleFontFamilyChange(event.target.value)}
                data-testid="editor-font-family-select"
                aria-label={t('editor.fontFamily.label')}
              >
                {FONT_FAMILIES.map((font) => (
                  <option key={font.value} value={font.value}>
                    {formatFontOptionLabel(font)}
                  </option>
                ))}
              </Select>
              <div
                data-testid="editor-font-preview"
                aria-label={t('editor.fontFamily.previewLabel')}
                className="rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-sm leading-6 text-fg-base"
                style={{
                  fontFamily,
                  fontVariantLigatures: ligaturesAvailable ? 'contextual' : 'none',
                  fontFeatureSettings: ligaturesAvailable ? undefined : '"liga" 0, "calt" 0',
                }}
              >
                {t('editor.fontFamily.previewSample')}
              </div>
            </div>
          }
        />

        <SpecRow
          label={t('editor.fontSize.label')}
          description={t('editor.fontSize.hint')}
          control={
            <div className="flex items-center gap-2">
              <StepperButton type="button" onClick={() => setFontSize(Math.max(10, fontSize - 1))}>
                -
              </StepperButton>
              <Select
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
                className="min-w-[7rem]"
                aria-label={t('editor.fontSize.label')}
              >
                {FONT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </Select>
              <StepperButton type="button" onClick={() => setFontSize(Math.min(32, fontSize + 1))}>
                +
              </StepperButton>
            </div>
          }
        />

        <SpecRow
          label={t('editor.maxIterations.label')}
          description={t('editor.maxIterations.hint')}
          control={
            <Select
              value={maxLoopIterations}
              onChange={(event) => setMaxLoopIterations(Number(event.target.value))}
              aria-label={t('editor.maxIterations.label')}
            >
              {[1000, 5000, 10000, 50000, 100000].map((count) => (
                <option key={count} value={count}>
                  {count.toLocaleString()}
                </option>
              ))}
            </Select>
          }
        />

        {/* RL-019 — default JS/TS runtime mode for new tabs. Disabled
            options still render with explanatory tooltips, while
            shipped modes keep their operational hints in Settings. */}
        <SpecRow
          label={t('runtimeMode.settings.title')}
          description={t('runtimeMode.settings.description')}
          control={
            <Select
              value={defaultRuntimeMode}
              onChange={(event) => setDefaultRuntimeMode(event.target.value as RuntimeMode)}
              aria-label={t('runtimeMode.settings.title')}
              data-testid="settings-default-runtime-mode"
            >
              {RUNTIME_MODES.map((mode) => {
                const enabled = isRuntimeModeImplemented(mode);
                const labelKey =
                  mode === 'browser-preview'
                    ? 'runtimeMode.mode.browserPreview'
                    : `runtimeMode.mode.${mode}`;
                const hintKey =
                  mode === 'worker'
                    ? 'runtimeMode.hint.worker'
                    : mode === 'node'
                      ? 'runtimeMode.hint.node.ready'
                      : 'runtimeMode.hint.browserPreview.shipping';
                return (
                  <option key={mode} value={mode} disabled={!enabled} title={t(hintKey)}>
                    {t(labelKey)}
                    {enabled ? '' : ` — ${t(hintKey)}`}
                  </option>
                );
              })}
            </Select>
          }
        />

        {/* RL-043 Slice C fold D — default language for new notebook code
            cells. Only the two runnable cell languages are offered. */}
        <SpecRow
          label={t('notebook.settings.defaultLanguage.title')}
          description={t('notebook.settings.defaultLanguage.description')}
          control={
            <Select
              value={notebookDefaultCellLanguage}
              onChange={(event) =>
                setNotebookDefaultCellLanguage(
                  event.target.value as 'javascript' | 'typescript'
                )
              }
              aria-label={t('notebook.settings.defaultLanguage.title')}
              data-testid="settings-notebook-default-language"
            >
              {(['javascript', 'typescript'] as const).map((lang) => (
                <option key={lang} value={lang}>
                  {languageLabel(lang)}
                </option>
              ))}
            </Select>
          }
        />

        {/* RL-093 Slice 3 — variable inspector surface preference. */}
        <SpecRow
          label={t('settings.editor.variableInspectorSurface.label')}
          description={t('settings.editor.variableInspectorSurface.hint')}
          last
          control={
            <Select
              value={variableInspectorSurface}
              onChange={(event) =>
                setVariableInspectorSurface(
                  event.target.value === 'bottom' ? 'bottom' : 'floating'
                )
              }
              aria-label={t('settings.editor.variableInspectorSurface.label')}
              data-testid="settings-variable-inspector-surface"
            >
              <option value="floating">
                {t('settings.editor.variableInspectorSurface.floating')}
              </option>
              <option value="bottom">
                {t('settings.editor.variableInspectorSurface.bottom')}
              </option>
            </Select>
          }
        />
      </SpecCard>

      {/* TOGGLES card — affine on/off editor behaviors grouped into one
          card with divided rows; the last row drops its hairline. */}
      <SpecCard>
        <SpecRow
          label={t('editor.wordWrap.label')}
          description={t('editor.wordWrap.hint')}
          control={<Toggle value={wordWrap} onChange={toggleWordWrap} />}
        />

        <SpecRow
          label={t('editor.minimap.label')}
          description={t('editor.minimap.hint')}
          control={<Toggle value={minimap} onChange={toggleMinimap} />}
        />

        {/* RL-108 — one row per lintable language. Slice 1 = JS/TS; a third
            language's lint adds a row here automatically. */}
        {(['javascript', 'typescript'] as const).map((lang, index) => (
          <SpecRow
            key={lang}
            label={t('editor.inlineLint.languageLabel', {
              language: t(`editor.inlineLint.language.${lang}`),
            })}
            description={index === 0 ? t('editor.inlineLint.hint') : undefined}
            control={
              <Toggle
                value={inlineLintEnabledByLanguage[lang] !== false}
                onChange={() =>
                  setInlineLintEnabled(lang, inlineLintEnabledByLanguage[lang] === false)
                }
              />
            }
          />
        ))}

        <SpecRow
          label={t('editor.restoreSession.label')}
          description={t('editor.restoreSession.hint')}
          control={
            <Select
              value={restoreSessionMode}
              onChange={(event) =>
                setRestoreSessionMode(event.target.value as typeof restoreSessionMode)
              }
              aria-label={t('editor.restoreSession.label')}
            >
              {(['never', 'ask', 'always'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`editor.restoreSession.mode.${mode}`)}
                </option>
              ))}
            </Select>
          }
        />

        <SpecRow
          label={t('editor.formatOnSave.label')}
          description={t('editor.formatOnSave.hint')}
          control={<Toggle value={formatOnSave} onChange={toggleFormatOnSave} />}
        />

        {/* RL-110 — smart paste detection master toggle. */}
        <SpecRow
          label={t('editor.smartPaste.label')}
          description={t('editor.smartPaste.hint')}
          control={
            <Toggle
              value={smartPasteDetectionEnabled}
              onChange={toggleSmartPasteDetection}
            />
          }
        />

        <SpecRow
          label={t('editor.executionHistorySnapshot.label')}
          description={
            canUseExecutionHistory
              ? t('editor.executionHistorySnapshot.hint')
              : t('editor.executionHistorySnapshot.lockedHint')
          }
          control={
            canUseExecutionHistory ? (
              <Toggle
                value={executionHistorySnapshotEnabled}
                onChange={toggleExecutionHistorySnapshot}
                aria-label={t('editor.executionHistorySnapshot.label')}
              />
            ) : (
              <button
                type="button"
                className="button-secondary"
                onClick={handleExecutionHistorySnapshotUnlock}
                data-testid="editor-execution-history-snapshot-unlock"
                aria-label={t('executionHistory.unlockButton')}
              >
                {t('executionHistory.unlockButton')}
              </button>
            )
          }
        />

        <SpecRow
          label={t('editor.vimMode.label')}
          description={t('editor.vimMode.hint')}
          control={
            <Toggle
              value={vimMode}
              onChange={toggleVimMode}
              aria-label={t('editor.vimMode.label')}
            />
          }
        />

        {/* RL-020 Slice 6 fold D — bottom-panel Input tab visibility.
            The buffer state per tab is preserved either way; hiding the
            tab keeps the leaner three-tab strip without losing data. */}
        <SpecRow
          label={t('stdin.settings.label')}
          description={t('stdin.settings.hint')}
          control={
            <Toggle
              value={showStdinPanel}
              onChange={toggleShowStdinPanel}
              aria-label={t('stdin.settings.label')}
              data-testid="settings-show-stdin-panel"
            />
          }
        />

        {/* RL-112 — persistent bottom status bar visibility. Default ON
            desktop / OFF web; when OFF the bar fully unmounts. */}
        <SpecRow
          label={t('settings.editor.showStatusBar.label')}
          description={t('settings.editor.showStatusBar.hint')}
          control={
            <Toggle
              value={showStatusBar}
              onChange={() => setShowStatusBar(!showStatusBar)}
              aria-label={t('settings.editor.showStatusBar.label')}
              data-testid="settings-show-status-bar"
            />
          }
        />

        <SpecRow
          label={t('settings.editor.dependencyDetection.label')}
          description={t('settings.editor.dependencyDetection.hint')}
          control={
            <Toggle
              value={dependencyDetectionEnabled}
              onChange={toggleDependencyDetectionEnabled}
              aria-label={t('settings.editor.dependencyDetection.label')}
              data-testid="settings-editor-dependency-detection-toggle"
            />
          }
        />

        {/* RL-020 Slice 7 fold E — countdown pill toggle. Default OFF
            so the result panel header stays quiet by default. */}
        <SpecRow
          label={t('runtime.timeout.countdown.label')}
          description={t('runtime.timeout.countdown.hint')}
          last
          control={
            <Toggle
              value={showTimeoutCountdown}
              onChange={toggleShowTimeoutCountdown}
              aria-label={t('runtime.timeout.countdown.label')}
              data-testid="settings-show-timeout-countdown"
            />
          }
        />
      </SpecCard>

      {/* PER-LANGUAGE card — the three sub-grids (workflow mode, auto-log,
          execution timeout) each keep their nested per-language grid as
          the spec-row control; the wide control fills a fixed column. */}
      <SpecCard>
        {/* RL-020 Slice 2 — per-language default workflow mode.
            Settings intentionally surfaces the lightweight in-process
            languages first (JS / TS / Python); Go / Rust keep the
            shared Scratchpad default until native-runner workflow
            presets get their own product pass. Each Select lists
            exactly the supported modes for the surfaced language. */}
        <SpecRow
          label={t('settings.workflowMode.title')}
          description={t('settings.workflowMode.description')}
          control={
            <div
              data-testid="settings-workflow-mode-defaults"
              className="grid w-72 gap-2"
            >
              {(['javascript', 'typescript', 'python'] as const).map((lang) => {
                const stored = workflowModeDefaultsByLanguage[lang];
                const value: WorkflowMode =
                  stored !== undefined ? stored : defaultWorkflowMode(lang);
                return (
                  <label
                    key={lang}
                    className="flex items-center justify-between gap-2 text-xs text-fg-base"
                  >
                    <span className="text-fg-muted">
                      {t(`workflowMode.languageLabel.${lang}`)}
                    </span>
                    <Select
                      value={value}
                      data-testid={`settings-workflow-mode-default-${lang}`}
                      onChange={(event) =>
                        setWorkflowModeDefault(lang, event.target.value as WorkflowMode)
                      }
                    >
                      {WORKFLOW_MODES.filter((mode) =>
                        supportsWorkflowMode(lang, mode)
                      ).map((mode) => (
                        <option key={mode} value={mode}>
                          {t(`workflowMode.${mode}.label`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                );
              })}
            </div>
          }
        />

        {/* RL-020 Slice 5 — per-language opt-in for the bare-expression
            auto-log mode. JS / TS only this slice. Default OFF so the
            first install never surfaces a wall of inline values before
            the user explicitly enables the feature. */}
        <SpecRow
          label={t('autoLog.settings.title')}
          description={t('autoLog.settings.description')}
          control={
            <div data-testid="settings-auto-log-defaults" className="grid w-72 gap-2">
              {(['javascript', 'typescript'] as const).map((lang) => {
                const enabled = scratchpadAutoLogByLanguage[lang] === true;
                return (
                  <label
                    key={lang}
                    className="flex items-center justify-between gap-2 text-xs text-fg-base"
                  >
                    <span className="text-fg-muted">
                      {t(`autoLog.settings.${lang}.label`)}
                    </span>
                    <Toggle
                      value={enabled}
                      onChange={() => setScratchpadAutoLogDefault(lang, !enabled)}
                      aria-label={t(`autoLog.settings.${lang}.label`)}
                      data-testid={`settings-auto-log-default-${lang}`}
                    />
                  </label>
                );
              })}
            </div>
          }
        />

        {/* RL-020 Slice 7 — per-language execution timeout preset.
            Four supported languages (JS / TS / Python / Go). Rust is
            intentionally absent because its desktop kill path is in
            main and unchanged. */}
        <SpecRow
          label={t('runtime.timeout.section.title')}
          description={t('runtime.timeout.section.description')}
          last
          control={
            <div
              data-testid="settings-runtime-timeout-presets"
              className="grid w-72 gap-2"
            >
              {RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES.map((lang) => {
                const stored = runtimeTimeoutPresetByLanguage[lang];
                const value: RuntimeTimeoutPreset =
                  stored !== undefined ? stored : defaultRuntimeTimeoutPreset(lang);
                return (
                  <label
                    key={lang}
                    className="flex items-center justify-between gap-2 text-xs text-fg-base"
                  >
                    <span className="text-fg-muted">
                      {t('runtime.timeout.row.label', {
                        language: t(`workflowMode.languageLabel.${lang}`),
                      })}
                    </span>
                    <Select
                      value={value}
                      data-testid={`settings-runtime-timeout-preset-${lang}`}
                      // RL-020 Slice 7 — the localized preset labels carry
                      // a parenthetical duration (`Quick (5s)` /
                      // `Rápida (5s)`). Tablet widths truncate the
                      // default `Select` so the duration disappears.
                      // Lock a minimum width so the trailing parenthesis
                      // always survives even on a 1024-wide viewport.
                      className="min-w-[8rem]"
                      onChange={(event) =>
                        setRuntimeTimeoutPreset(
                          lang,
                          event.target.value as RuntimeTimeoutPreset
                        )
                      }
                      aria-label={t('runtime.timeout.row.label', {
                        language: t(`workflowMode.languageLabel.${lang}`),
                      })}
                    >
                      {RUNTIME_TIMEOUT_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {t(`runtime.timeout.preset.${preset}.label`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                );
              })}
            </div>
          }
        />
      </SpecCard>
      </SettingsSection>

      {/* RL-097 Slice 3 fold D — SQL workspace defaults render as their
          own sibling SettingsSection (mirrors the ThemePresetControls
          sibling below) so the title + description label the row-display
          limit + query-timeout controls, both bound to the (clamped)
          settings actions shipped in Slice 2. */}
      <SettingsSection
        eyebrow={t('settings.editor.sqlWorkspace.title')}
        description={t('settings.editor.sqlWorkspace.description')}
      >
        <SpecCard>
          <SpecRow
            label={t('settings.editor.sqlWorkspace.rowDisplayLimit.label')}
            description={t('settings.editor.sqlWorkspace.rowDisplayLimit.hint')}
            control={
              <Select
                value={sqlWorkspaceRowDisplayLimit}
                onChange={(event) =>
                  setSqlWorkspaceRowDisplayLimit(
                    Number(event.target.value) as 100 | 500 | 1000 | 5000
                  )
                }
                aria-label={t('settings.editor.sqlWorkspace.rowDisplayLimit.label')}
                data-testid="settings-sql-row-display-limit"
              >
                {SQL_ROW_DISPLAY_LIMITS.map((limit) => (
                  <option key={limit} value={limit}>
                    {limit.toLocaleString()}
                  </option>
                ))}
              </Select>
            }
          />

          <SpecRow
            label={t('settings.editor.sqlWorkspace.queryTimeout.label')}
            description={t('settings.editor.sqlWorkspace.queryTimeout.hint')}
            control={
              <Select
                value={sqlWorkspaceQueryTimeoutMs}
                onChange={(event) =>
                  setSqlWorkspaceQueryTimeoutMs(Number(event.target.value))
                }
                aria-label={t('settings.editor.sqlWorkspace.queryTimeout.label')}
                data-testid="settings-sql-query-timeout"
              >
                {SQL_QUERY_TIMEOUT_PRESETS.map((preset) => (
                  <option key={preset.ms} value={preset.ms}>
                    {t(preset.labelKey)}
                  </option>
                ))}
              </Select>
            }
          />

          {/* RL-097 Slice 3 (SQL OPFS) — opt into persisting the DuckDB
              database to OPFS. Off by default; the runtime falls back to
              in-memory when OPFS is unavailable. Takes effect on the next
              reload or via the Reconnect now action below. */}
          <SpecRow
            label={t('settings.editor.sqlWorkspace.persistTables.label')}
            description={
              opfsAvailable
                ? t('settings.editor.sqlWorkspace.persistTables.hint')
                : `${t('settings.editor.sqlWorkspace.persistTables.hint')} ${t('settings.editor.sqlWorkspace.persistTables.unavailable')}`
            }
            last
            control={
              <Toggle
                value={sqlWorkspacePersistTables}
                onChange={() =>
                  setSqlWorkspacePersistTables(!sqlWorkspacePersistTables)
                }
                aria-label={t('settings.editor.sqlWorkspace.persistTables.label')}
              />
            }
          />
        </SpecCard>

        {/* RL-097 Slice 3 (SQL OPFS) folds E — apply the toggle to the
            live engine without a reload, and wipe the persisted database.
            Both are session-affecting, so each confirms first. */}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="button-secondary"
            onClick={handleReconnectSql}
            data-testid="settings-sql-reconnect"
          >
            {t('settings.editor.sqlWorkspace.persistTables.reconnect')}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={handleClearSqlData}
            data-testid="settings-sql-clear-data"
          >
            {t('settings.editor.sqlWorkspace.persistTables.clear')}
          </button>
        </div>
      </SettingsSection>

      {/* RL-095 Slice 1 (post-review refactor) — the Language Support
          Scorecard + per-language preference rows (Rust / Go LSP, Ruby
          runtime) moved to their own Settings → Languages tab
          (`LanguagesSection.tsx`, Cmd+8). The Editor tab now stays
          focused on editor-shell concerns. ThemePresetControls renders
          as its own sibling SettingsSection below. */}
      <ThemePresetControls />
    </div>
  );
}
