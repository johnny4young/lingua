import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { EDITOR_THEMES, FONT_FAMILIES, FONT_SIZES } from './settingsOptions';
import { Row, Section, Select, StepperButton, Toggle } from './shared';

export function EditorSection() {
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const setEditorTheme = useSettingsStore((state) => state.setEditorTheme);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const setFontFamily = useSettingsStore((state) => state.setFontFamily);
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
  const { t } = useTranslation();

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

      <Row label={t('editor.fontFamily.label')} hint={t('editor.fontFamily.hint')}>
        <Select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
          {FONT_FAMILIES.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </Select>
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
    </Section>
  );
}
