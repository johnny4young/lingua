import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  EDITOR_THEMES,
  FONT_FAMILIES,
  FONT_SIZES,
  fontStackSupportsLigatures,
} from './settingsOptions';
import { Row, Section, Select, StepperButton, Toggle } from './shared';
import { ThemePresetControls } from './ThemePresetControls';

export function EditorSection() {
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
  const syncShellWithEditorTheme = useSettingsStore(
    (state) => state.syncShellWithEditorTheme
  );
  const toggleSyncShellWithEditorTheme = useSettingsStore(
    (state) => state.toggleSyncShellWithEditorTheme
  );
  const { t } = useTranslation();
  const ligaturesAvailable = fontStackSupportsLigatures(fontFamily);

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
          <Select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
            {FONT_FAMILIES.map((font) => (
              <option key={font.value} value={font.value}>
                {font.supportsLigatures
                  ? t('editor.fontFamily.optionWithLigatures', { name: font.label })
                  : font.label}
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
        label={t('editor.vimMode.label')}
        hint={t('editor.vimMode.hint')}
      >
        <div className="grid w-full gap-1 text-right">
          <Toggle
            value={vimMode}
            onChange={toggleVimMode}
            aria-label={t('editor.vimMode.label')}
          />
          <span
            data-testid="editor-vim-mode-status"
            className="text-xs text-muted"
          >
            {t('editor.vimMode.pendingNote')}
          </span>
        </div>
      </Row>

      <ThemePresetControls />
    </Section>
  );
}
