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

  return (
    <Section
      title="Editor"
      description="Keep the Monaco surface aligned with how you read code and how aggressively you want automatic safeguards."
    >
      <Row label="Editor theme" hint="Controls Monaco only. App shell theme stays independent.">
        <Select value={editorTheme} onChange={(event) => setEditorTheme(event.target.value)}>
          {EDITOR_THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Font family" hint="Use a coding typeface that matches your workflow.">
        <Select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
          {FONT_FAMILIES.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </Select>
      </Row>

      <Row label="Font size" hint="Adjust the editor scale without touching the shell density.">
        <div className="flex items-center gap-2">
          <StepperButton onClick={() => setFontSize(Math.max(10, fontSize - 1))}>
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
          <StepperButton onClick={() => setFontSize(Math.min(32, fontSize + 1))}>
            +
          </StepperButton>
        </div>
      </Row>

      <Row label="Line numbers" hint="Keep gutter references visible while editing.">
        <Toggle value={showLineNumbers} onChange={toggleLineNumbers} />
      </Row>

      <Row label="Word wrap" hint="Wrap long lines inside the viewport.">
        <Toggle value={wordWrap} onChange={toggleWordWrap} />
      </Row>

      <Row label="Minimap" hint="Show the code overview strip on the right edge.">
        <Toggle value={minimap} onChange={toggleMinimap} />
      </Row>

      <Row
        label="Loop protection"
        hint="Stops runaway JS and TS loops before they lock the renderer."
      >
        <Toggle value={loopProtection} onChange={toggleLoopProtection} />
      </Row>

      {loopProtection && (
        <Row label="Max iterations" hint="Applies to the inline dynamic language runners.">
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
        label="Reopen last session"
        hint="Restore tabs from the previous session on restart."
      >
        <Toggle value={restoreSession} onChange={toggleRestoreSession} />
      </Row>
    </Section>
  );
}
