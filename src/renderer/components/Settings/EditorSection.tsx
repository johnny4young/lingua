import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n/formatNumber';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useNativeJsRuntimeAvailability } from '../../hooks/useNativeJsRuntimeAvailability';
import { useSettingsStore } from '../../stores/settingsStore';
import { trackEvent } from '../../utils/telemetry';
import { isNativeJsRuntimeMode, nativeJsRuntimeHintKey } from '../../utils/nativeJsRuntimeStatus';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import {
  DEFAULT_FONT_FAMILY,
  EDITOR_THEMES,
  FONT_FAMILIES,
  FONT_SIZES,
} from './settingsOptions';
import { Select, StepperButton, Toggle } from './shared';
import { SpecCard, SpecRow, SettingsSection, UnlockProLink } from '../ui/SpecRow';
import { languageLabel } from '../../utils/languageMeta';
import { RunPolicySection } from './RunPolicySection';
import { SqlWorkspaceSettingsSection } from './SqlWorkspaceSettingsSection';
import { PerLanguageDefaultsSection } from './PerLanguageDefaultsSection';
import {
  currentShortcutDisplayPlatform,
  formatShortcutCombo,
} from '../../data/keyboardShortcuts';
import {
  RUNTIME_MODES,
  isRuntimeModeSupportedInShell,
  type RuntimeMode,
} from '../../../shared/runtimeModes';
import {
  BROWSER_PREVIEW_REFRESH_INTERVALS,
  isBrowserPreviewRefreshInterval,
} from '../../../shared/browserPreviewRefresh';

export function EditorSection() {
  const isWebBuild = typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const { availability: nativeRuntimeAvailability, recoverMissing } =
    useNativeJsRuntimeAvailability(!isWebBuild);
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
  const browserPreviewRefreshIntervalMs = useSettingsStore(
    (state) => state.browserPreviewRefreshIntervalMs
  );
  const setBrowserPreviewRefreshInterval = useSettingsStore(
    (state) => state.setBrowserPreviewRefreshInterval
  );
  // Inline lint is stored + surfaced per language, so adding a
  // language's lint in a later work lights up a new row without a re-layout.
  const inlineLintEnabledByLanguage = useSettingsStore(
    (state) => state.inlineLintEnabledByLanguage
  );
  const setInlineLintEnabled = useSettingsStore((state) => state.setInlineLintEnabled);
  const showStdinPanel = useSettingsStore((state) => state.showStdinPanel);
  const toggleShowStdinPanel = useSettingsStore((state) => state.toggleShowStdinPanel);
  // Master visibility toggle for the persistent bottom status bar.
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  const setShowStatusBar = useSettingsStore((state) => state.setShowStatusBar);
  const variableInspectorSurface = useSettingsStore(
    (state) => state.variableInspectorSurface
  );
  const setVariableInspectorSurface = useSettingsStore(
    (state) => state.setVariableInspectorSurface
  );
  const showTimeoutCountdown = useSettingsStore(
    (state) => state.showTimeoutCountdown
  );
  const toggleShowTimeoutCountdown = useSettingsStore(
    (state) => state.toggleShowTimeoutCountdown
  );
  const showLineTiming = useSettingsStore((state) => state.showLineTiming);
  const toggleShowLineTiming = useSettingsStore(
    (state) => state.toggleShowLineTiming
  );
  const executionHistorySnapshotEnabled = useSettingsStore(
    (state) => state.executionHistorySnapshotEnabled
  );
  const toggleExecutionHistorySnapshot = useSettingsStore(
    (state) => state.toggleExecutionHistorySnapshot
  );
  // Dependency detection master switch.
  const dependencyDetectionEnabled = useSettingsStore(
    (state) => state.dependencyDetectionEnabled
  );
  const toggleDependencyDetectionEnabled = useSettingsStore(
    (state) => state.toggleDependencyDetectionEnabled
  );
  const { t, i18n } = useTranslation();
  // Ligatures auto-enable when the active font supports them.
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
    // Editor, Per-language and SQL render as sibling SettingsSections, each a section chip.
    <div className="space-y-6">
      <SettingsSection eyebrow={t('editor.title')}>
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
          searchTargetId="editor-font-family"
          label={t('editor.fontFamily.label')}
          strong
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
                className="rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-body leading-6 text-fg-base"
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
          searchTargetId="editor-font-size"
          label={t('editor.fontSize.label')}
          strong
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
                  {formatNumber(count, i18n.language)}
                </option>
              ))}
            </Select>
          }
        />

        {/* Default JS/TS runtime mode for new tabs. Disabled
            options still render with explanatory tooltips, while
            shipped modes keep their operational hints in Settings. */}
        <SpecRow
          searchTargetId="editor-default-runtime"
          label={t('runtimeMode.settings.title')}
          description={t('runtimeMode.settings.description')}
          control={
            <Select
              value={defaultRuntimeMode}
              onChange={(event) => {
                const mode = event.target.value as RuntimeMode;
                if (isNativeJsRuntimeMode(mode) && nativeRuntimeAvailability[mode] === 'missing') {
                  recoverMissing(mode);
                  return;
                }
                setDefaultRuntimeMode(mode);
              }}
              aria-label={t('runtimeMode.settings.title')}
              data-testid="settings-default-runtime-mode"
            >
              {RUNTIME_MODES.map((mode) => {
                const enabled = isRuntimeModeSupportedInShell(
                  mode,
                  isWebBuild,
                );
                const labelKey =
                  mode === 'browser-preview'
                    ? 'runtimeMode.mode.browserPreview'
                    : `runtimeMode.mode.${mode}`;
                const hintKey = !enabled
                  ? 'runtimeMode.hint.desktopOnly'
                  : isNativeJsRuntimeMode(mode)
                    ? nativeJsRuntimeHintKey(mode, nativeRuntimeAvailability[mode])
                    : mode === 'worker'
                      ? 'runtimeMode.hint.worker'
                      : 'runtimeMode.hint.browserPreview.shipping';
                return (
                  <option key={mode} value={mode} disabled={!enabled} title={t(hintKey)}>
                    {t(labelKey)}
                    {enabled && (!isNativeJsRuntimeMode(mode) || nativeRuntimeAvailability[mode] === 'installed')
                      ? ''
                      : ` — ${t(hintKey)}`}
                  </option>
                );
              })}
            </Select>
          }
        />

        {/* Default language for new notebook code
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

        {/* Variable inspector surface preference. */}
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
          searchTargetId="editor-word-wrap"
          label={t('editor.wordWrap.label')}
          strong
          control={<Toggle value={wordWrap} onChange={toggleWordWrap} />}
        />

        <SpecRow
          label={t('editor.minimap.label')}
          strong
          control={<Toggle value={minimap} onChange={toggleMinimap} />}
        />

        {/* One row per lintable language. implementation = JS/TS; a third
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
          searchTargetId="editor-restore-session"
          label={t('editor.restoreSession.label')}
          strong
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
          searchTargetId="editor-format-on-save"
          label={t('editor.formatOnSave.label')}
          description={t('editor.formatOnSave.hint')}
          control={<Toggle value={formatOnSave} onChange={toggleFormatOnSave} />}
        />

        {/* Smart paste detection master toggle. */}
        <SpecRow
          searchTargetId="editor-smart-paste"
          label={t('editor.smartPaste.label')}
          description={t('editor.smartPaste.hint', {
            combo: formatShortcutCombo(
              { tokens: ['Mod', 'Shift', 'V'] },
              currentShortcutDisplayPlatform()
            ),
          })}
          control={
            <Toggle
              value={smartPasteDetectionEnabled}
              onChange={toggleSmartPasteDetection}
            />
          }
        />

        <SpecRow
          label={t('editor.executionHistorySnapshot.label')}
          pro={!canUseExecutionHistory}
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
              <UnlockProLink
                onClick={handleExecutionHistorySnapshotUnlock}
                testId="editor-execution-history-snapshot-unlock"
              />
            )
          }
        />

        <SpecRow
          searchTargetId="editor-vim-mode"
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

        {/* bottom-panel Input tab visibility.
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

        {/* Persistent bottom status bar visibility. Default ON
            desktop / OFF web; when OFF the bar fully unmounts. */}
        <SpecRow
          searchTargetId="editor-status-bar"
          label={t('settings.editor.showStatusBar.label')}
          strong
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
          searchTargetId="editor-dependency-detection"
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

        {/* Countdown pill toggle. Default OFF
            so the results dock header stays quiet by default. */}
        <SpecRow
          label={t('runtime.timeout.countdown.label')}
          strong
          control={
            <Toggle
              value={showTimeoutCountdown}
              onChange={toggleShowTimeoutCountdown}
              aria-label={t('runtime.timeout.countdown.label')}
              data-testid="settings-show-timeout-countdown"
            />
          }
        />

        {/* per-line timing toggle. Default OFF: the
            instrumentation adds a small overhead per statement, so it
            is a deliberate opt-in (or per-buffer via // @time). */}
        <SpecRow
          label={t('settings.editor.showLineTiming.label')}
          description={t('settings.editor.showLineTiming.hint')}
          control={
            <Toggle
              value={showLineTiming}
              onChange={toggleShowLineTiming}
              aria-label={t('settings.editor.showLineTiming.label')}
              data-testid="settings-show-line-timing"
            />
          }
        />

        {/* Browser preview reuses Scratchpad auto-run, but
            carries its own fast closed-enum debounce. The first-line magic
            comment can override this setting per tab. */}
        <SpecRow
          label={t('browserPreview.autoRefresh.settings.label')}
          description={t('browserPreview.autoRefresh.settings.hint')}
          last
          control={
            <Select
              value={browserPreviewRefreshIntervalMs}
              data-testid="settings-browser-preview-auto-refresh"
              aria-label={t('browserPreview.autoRefresh.settings.label')}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (isBrowserPreviewRefreshInterval(next)) {
                  setBrowserPreviewRefreshInterval(next);
                }
              }}
            >
              {BROWSER_PREVIEW_REFRESH_INTERVALS.map((intervalMs) => (
                <option key={intervalMs} value={intervalMs}>
                  {t(
                    intervalMs === 0
                      ? 'browserPreview.autoRefresh.option.off'
                      : intervalMs === 300
                        ? 'browserPreview.autoRefresh.option.fast'
                        : 'browserPreview.autoRefresh.option.conservative'
                  )}
                </option>
              ))}
            </Select>
          }
        />

      </SpecCard>
      </SettingsSection>

      <RunPolicySection />

      <PerLanguageDefaultsSection />

      <SqlWorkspaceSettingsSection />
    </div>
  );
}
