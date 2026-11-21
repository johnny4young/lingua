import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { configureMonaco, registerLanguageOnce } from '../../monaco';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Language } from '../../types/language';
import { monacoLanguageFor } from '../../utils/languageMeta';
import { getSatelliteEditorOptions } from '../Editor/editorOptions';
import { defineCustomThemes } from '../Editor/editorThemes';
import { toOneLine } from './startPromptModel';

configureMonaco();

const FONT_SIZE = 20;
const LINE_HEIGHT = 32;
// Enter yields to Monaco's own widgets, so it still accepts a suggestion.
const SUBMIT_WHEN = 'editorTextFocus && !suggestWidgetVisible && !renameInputVisible && !inlineSuggestionVisible';

const ONE_LINE_OPTIONS = {
  lineHeight: LINE_HEIGHT,
  lineNumbers: 'off',
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 0,
  renderLineHighlight: 'none',
  wordWrap: 'off',
  padding: { top: 0, bottom: 0 },
  scrollbar: { vertical: 'hidden', horizontal: 'hidden', alwaysConsumeMouseWheel: false, handleMouseWheel: false },
  scrollBeyondLastColumn: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  occurrencesHighlight: 'off',
  selectionHighlight: false,
  matchBrackets: 'never',
  bracketPairColorization: { enabled: false },
  guides: { indentation: false, bracketPairs: false },
  contextmenu: false,
  links: false,
  stickyScroll: { enabled: false },
  fixedOverflowWidgets: true,
} as const;

export interface StartPromptEditorProps {
  language: Language;
  value: string;
  ariaLabel: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Width of the typed text, so the leader to the answer starts where the line ends. */
  onTextWidth: (width: number) => void;
  onReady: (focus: () => void) => void;
}

/** One-line Monaco: no gutter, no scrollbars, Enter submits, pasted line breaks become spaces. */
export function StartPromptEditor({
  language,
  value,
  ariaLabel,
  placeholder,
  onChange,
  onSubmit,
  onTextWidth,
  onReady,
}: StartPromptEditorProps) {
  const editorTheme = useSettingsStore(state => state.editorTheme);
  const fontFamily = useSettingsStore(state => state.fontFamily);
  const monacoLanguage = monacoLanguageFor(language);
  // Handlers Monaco holds from mount read the latest props from here.
  const callbacks = useRef({ onChange, onSubmit, onTextWidth });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onTextWidth };
  }, [onChange, onSubmit, onTextWidth]);

  const options = useMemo(
    () => ({ ...getSatelliteEditorOptions({ fontSize: FONT_SIZE, fontFamily, ariaLabel }), ...ONE_LINE_OPTIONS, placeholder }),
    [fontFamily, ariaLabel, placeholder]
  );

  const handleBeforeMount = useCallback(
    (monaco: Monaco) => {
      defineCustomThemes(monaco);
      void registerLanguageOnce(monaco, monacoLanguage);
    },
    [monacoLanguage]
  );

  const handleChange = useCallback((next: string | undefined) => callbacks.current.onChange(next ?? ''), []);

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      const submit = () => callbacks.current.onSubmit();
      editor.addCommand(monaco.KeyCode.Enter, submit, SUBMIT_WHEN);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, submit, SUBMIT_WHEN);
      const measure = () => {
        const model = editor.getModel();
        const charWidth = editor.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
        callbacks.current.onTextWidth(model ? (model.getLineMaxColumn(1) - 1) * charWidth : 0);
      };
      editor.onDidChangeModelContent(() => {
        const model = editor.getModel();
        if (model && model.getLineCount() > 1) {
          const text = toOneLine(model.getValue());
          editor.executeEdits('start-prompt', [{ range: model.getFullModelRange(), text }]);
          editor.setPosition({ lineNumber: 1, column: text.length + 1 });
        }
        measure();
      });
      editor.onDidChangeConfiguration(measure);
      // The field narrows once an answer shows; keep the caret in view.
      editor.onDidLayoutChange(() => {
        const position = editor.getPosition();
        if (position) editor.revealPosition(position);
      });
      measure();
      onReady(() => editor.focus());
    },
    [onReady]
  );

  return (
    <MonacoEditor
      height={LINE_HEIGHT}
      language={monacoLanguage}
      value={value}
      theme={editorTheme}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      onChange={handleChange}
      loading={null}
      options={options}
    />
  );
}
