import { useSettingsStore } from '../../stores/settingsStore';
import { FONT_FAMILIES, FONT_SIZES, EDITOR_THEMES } from './settingsOptions';
import { Row, Section, Toggle } from './shared';

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

  return (
    <Section title="Editor">
      <Row label="Theme">
        <select
          value={editorTheme}
          onChange={(event) => setEditorTheme(event.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none focus:border-primary-500"
        >
          {EDITOR_THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Font family">
        <select
          value={fontFamily}
          onChange={(event) => setFontFamily(event.target.value)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none focus:border-primary-500"
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Font size">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFontSize(Math.max(10, fontSize - 1))}
            className="flex h-6 w-6 items-center justify-center rounded bg-gray-800 text-gray-300 transition-colors hover:bg-gray-700"
          >
            -
          </button>
          <select
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none focus:border-primary-500"
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
          <button
            onClick={() => setFontSize(Math.min(32, fontSize + 1))}
            className="flex h-6 w-6 items-center justify-center rounded bg-gray-800 text-gray-300 transition-colors hover:bg-gray-700"
          >
            +
          </button>
        </div>
      </Row>
      <Row label="Line numbers">
        <Toggle value={showLineNumbers} onChange={toggleLineNumbers} />
      </Row>
      <Row label="Word wrap">
        <Toggle value={wordWrap} onChange={toggleWordWrap} />
      </Row>
      <Row label="Minimap">
        <Toggle value={minimap} onChange={toggleMinimap} />
      </Row>
    </Section>
  );
}
