import { useTranslation } from 'react-i18next';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useSettingsStore } from '../../stores/settingsStore';
import { trackEvent } from '../../utils/telemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import {
  DEFAULT_FONT_FAMILY,
  EDITOR_THEMES,
  FONT_FAMILIES,
  FONT_SIZES,
  fontStackSupportsLigatures,
} from './settingsOptions';
import { GoLanguageIntelligenceRow } from './GoLanguageIntelligenceRow';
import { RustLanguageIntelligenceRow } from './RustLanguageIntelligenceRow';
import { Row, Section, Select, StepperButton, Toggle } from './shared';
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

export function EditorSection() {
  const effectiveTier = useEffectiveTier();
  const canUseExtendedFonts = useEntitlement('FONT_PACK_EXTENDED');
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const setEditorTheme = useSettingsStore((state) => state.setEditorTheme);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const setFontFamily = useSettingsStore((state) => state.setFontFamily);
  const fontLigatures = useSettingsStore((state) => state.fontLigatures);
  const toggleFontLigatures = useSettingsStore((state) => state.toggleFontLigatures);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setFontSize = useSettingsStore((state) => state.setFontSize);
  const showLineNumbers = useSettingsStore((state) => state.showLineNumbers);
  const toggleLineNumbers = useSettingsStore((state) => state.toggleLineNumbers);
  const wordWrap = useSettingsStore((state) => state.wordWrap);
  const toggleWordWrap = useSettingsStore((state) => state.toggleWordWrap);
  const minimap = useSettingsStore((state) => state.minimap);
  const toggleMinimap = useSettingsStore((state) => state.toggleMinimap);
  const loopProtection = useSettingsStore((state) => state.loopProtection);
  const toggleLoopProtection = useSettingsStore((state) => state.toggleLoopProtection);
  const maxLoopIterations = useSettingsStore((state) => state.maxLoopIterations);
  const setMaxLoopIterations = useSettingsStore((state) => state.setMaxLoopIterations);
  const restoreSession = useSettingsStore((state) => state.restoreSession);
  const toggleRestoreSession = useSettingsStore((state) => state.toggleRestoreSession);
  const formatOnSave = useSettingsStore((state) => state.formatOnSave);
  const toggleFormatOnSave = useSettingsStore((state) => state.toggleFormatOnSave);
  const vimMode = useSettingsStore((state) => state.vimMode);
  const toggleVimMode = useSettingsStore((state) => state.toggleVimMode);
  const defaultRuntimeMode = useSettingsStore((state) => state.defaultRuntimeMode);
  const setDefaultRuntimeMode = useSettingsStore((state) => state.setDefaultRuntimeMode);
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
  const showStdinPanel = useSettingsStore((state) => state.showStdinPanel);
  const toggleShowStdinPanel = useSettingsStore((state) => state.toggleShowStdinPanel);
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
  const syncShellWithEditorTheme = useSettingsStore(
    (state) => state.syncShellWithEditorTheme
  );
  const toggleSyncShellWithEditorTheme = useSettingsStore(
    (state) => state.toggleSyncShellWithEditorTheme
  );
  const executionHistorySnapshotEnabled = useSettingsStore(
    (state) => state.executionHistorySnapshotEnabled
  );
  const toggleExecutionHistorySnapshot = useSettingsStore(
    (state) => state.toggleExecutionHistorySnapshot
  );
  const debuggerEnabled = useSettingsStore((state) => state.debuggerEnabled);
  const toggleDebuggerEnabled = useSettingsStore((state) => state.toggleDebuggerEnabled);
  const { t } = useTranslation();
  const ligaturesAvailable = fontStackSupportsLigatures(fontFamily);

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
    <Section
      title={t('editor.title')}
      description={t('editor.description')}
    >
      <Row label={t('editor.theme.label')} hint={t('editor.theme.hint')}>
        <Select value={editorTheme} onChange={(event) => setEditorTheme(event.target.value)}>
          {EDITOR_THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
        </Select>
      </Row>

      <Row
        label={t('editor.syncShellWithEditorTheme.label')}
        hint={t('editor.syncShellWithEditorTheme.hint')}
      >
        <Toggle
          value={syncShellWithEditorTheme}
          onChange={toggleSyncShellWithEditorTheme}
        />
      </Row>

      <Row label={t('editor.fontFamily.label')} hint={t('editor.fontFamily.hint')}>
        <div className="grid w-full gap-2">
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
            className="rounded-[0.9rem] border border-border/80 bg-background/65 px-3 py-2 text-sm leading-6 text-foreground"
            style={{
              fontFamily,
              fontVariantLigatures: ligaturesAvailable && fontLigatures ? 'contextual' : 'none',
              fontFeatureSettings: ligaturesAvailable && fontLigatures ? undefined : '"liga" 0, "calt" 0',
            }}
          >
            {t('editor.fontFamily.previewSample')}
          </div>
        </div>
      </Row>

      <Row
        label={t('editor.fontLigatures.label')}
        hint={
          ligaturesAvailable
            ? t('editor.fontLigatures.hint')
            : t('editor.fontLigatures.unavailableHint')
        }
      >
        <Toggle
          value={fontLigatures && ligaturesAvailable}
          onChange={toggleFontLigatures}
          disabled={!ligaturesAvailable}
        />
      </Row>

      <Row label={t('editor.fontSize.label')} hint={t('editor.fontSize.hint')}>
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
      </Row>

      <Row label={t('editor.lineNumbers.label')} hint={t('editor.lineNumbers.hint')}>
        <Toggle value={showLineNumbers} onChange={toggleLineNumbers} />
      </Row>

      <Row label={t('editor.wordWrap.label')} hint={t('editor.wordWrap.hint')}>
        <Toggle value={wordWrap} onChange={toggleWordWrap} />
      </Row>

      <Row label={t('editor.minimap.label')} hint={t('editor.minimap.hint')}>
        <Toggle value={minimap} onChange={toggleMinimap} />
      </Row>

      <Row
        label={t('editor.loopProtection.label')}
        hint={t('editor.loopProtection.hint')}
      >
        <Toggle value={loopProtection} onChange={toggleLoopProtection} />
      </Row>

      {loopProtection && (
        <Row label={t('editor.maxIterations.label')} hint={t('editor.maxIterations.hint')}>
          <Select
            value={maxLoopIterations}
            onChange={(event) => setMaxLoopIterations(Number(event.target.value))}
          >
            {[1000, 5000, 10000, 50000, 100000].map((count) => (
              <option key={count} value={count}>
                {count.toLocaleString()}
              </option>
            ))}
          </Select>
        </Row>
      )}

      <Row
        label={t('editor.restoreSession.label')}
        hint={t('editor.restoreSession.hint')}
      >
        <Toggle value={restoreSession} onChange={toggleRestoreSession} />
      </Row>

      <Row
        label={t('editor.formatOnSave.label')}
        hint={t('editor.formatOnSave.hint')}
      >
        <Toggle value={formatOnSave} onChange={toggleFormatOnSave} />
      </Row>

      <Row
        label={t('editor.executionHistorySnapshot.label')}
        hint={
          canUseExecutionHistory
            ? t('editor.executionHistorySnapshot.hint')
            : t('editor.executionHistorySnapshot.lockedHint')
        }
      >
        {canUseExecutionHistory ? (
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
        )}
      </Row>

      <Row
        label={t('editor.vimMode.label')}
        hint={t('editor.vimMode.hint')}
      >
        <Toggle
          value={vimMode}
          onChange={toggleVimMode}
          aria-label={t('editor.vimMode.label')}
        />
      </Row>

      {/* RL-019 — default JS/TS runtime mode for new tabs. Disabled
          options still render with explanatory tooltips, while
          shipped modes keep their operational hints in Settings. */}
      <Row
        label={t('runtimeMode.settings.title')}
        hint={t('runtimeMode.settings.description')}
      >
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
      </Row>

      {/* RL-020 Slice 2 — per-language default workflow mode.
          Settings intentionally surfaces the lightweight in-process
          languages first (JS / TS / Python); Go / Rust keep the
          shared Scratchpad default until native-runner workflow
          presets get their own product pass. Each Select lists
          exactly the supported modes for the surfaced language. */}
      <Row
        label={t('settings.workflowMode.title')}
        hint={t('settings.workflowMode.description')}
      >
        <div
          data-testid="settings-workflow-mode-defaults"
          className="grid gap-2"
        >
          {(['javascript', 'typescript', 'python'] as const).map((lang) => {
            const stored = workflowModeDefaultsByLanguage[lang];
            const value: WorkflowMode =
              stored !== undefined ? stored : defaultWorkflowMode(lang);
            return (
              <label
                key={lang}
                className="flex items-center justify-between gap-2 text-xs text-foreground"
              >
                <span className="text-muted">
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
      </Row>

      {/* RL-020 Slice 5 — per-language opt-in for the bare-expression
          auto-log mode. JS / TS only this slice. Default OFF so the
          first install never surfaces a wall of inline values before
          the user explicitly enables the feature. */}
      <Row
        label={t('autoLog.settings.title')}
        hint={t('autoLog.settings.description')}
      >
        <div data-testid="settings-auto-log-defaults" className="grid gap-2">
          {(['javascript', 'typescript'] as const).map((lang) => {
            const enabled = scratchpadAutoLogByLanguage[lang] === true;
            return (
              <label
                key={lang}
                className="flex items-center justify-between gap-2 text-xs text-foreground"
              >
                <span className="text-muted">
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
      </Row>

      {/* RL-020 Slice 7 — per-language execution timeout preset.
          Four supported languages (JS / TS / Python / Go). Rust is
          intentionally absent because its desktop kill path is in
          main and unchanged. */}
      <Row
        label={t('runtime.timeout.section.title')}
        hint={t('runtime.timeout.section.description')}
      >
        <div
          data-testid="settings-runtime-timeout-presets"
          className="grid gap-2"
        >
          {RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES.map((lang) => {
            const stored = runtimeTimeoutPresetByLanguage[lang];
            const value: RuntimeTimeoutPreset =
              stored !== undefined ? stored : defaultRuntimeTimeoutPreset(lang);
            return (
              <label
                key={lang}
                className="flex items-center justify-between gap-2 text-xs text-foreground"
              >
                <span className="text-muted">
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
      </Row>

      {/* RL-020 Slice 7 fold E — countdown pill toggle. Default OFF
          so the result panel header stays quiet by default. */}
      <Row
        label={t('runtime.timeout.countdown.label')}
        hint={t('runtime.timeout.countdown.hint')}
      >
        <Toggle
          value={showTimeoutCountdown}
          onChange={toggleShowTimeoutCountdown}
          aria-label={t('runtime.timeout.countdown.label')}
          data-testid="settings-show-timeout-countdown"
        />
      </Row>

      {/* RL-020 Slice 6 fold D — bottom-panel Input tab visibility.
          The buffer state per tab is preserved either way; hiding the
          tab keeps the leaner three-tab strip without losing data. */}
      <Row label={t('stdin.settings.label')} hint={t('stdin.settings.hint')}>
        <Toggle
          value={showStdinPanel}
          onChange={toggleShowStdinPanel}
          aria-label={t('stdin.settings.label')}
          data-testid="settings-show-stdin-panel"
        />
      </Row>

      {/* RL-093 Slice 3 — variable inspector surface preference. */}
      <Row
        label={t('settings.editor.variableInspectorSurface.label')}
        hint={t('settings.editor.variableInspectorSurface.hint')}
      >
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
      </Row>

      <Row label={t('debugger.settings.label')} hint={t('debugger.settings.hint')}>
        <Toggle
          value={debuggerEnabled}
          onChange={toggleDebuggerEnabled}
          aria-label={t('debugger.settings.label')}
        />
      </Row>

      <RustLanguageIntelligenceRow />
      <GoLanguageIntelligenceRow />

      <ThemePresetControls />
    </Section>
  );
}
