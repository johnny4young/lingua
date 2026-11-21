import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, type ClipboardEvent } from 'react';
import { configureMonaco, registerLanguageOnce } from '../../monaco';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Language } from '../../types/language';
import { monacoLanguageFor } from '../../utils/languageMeta';
import { getSatelliteEditorOptions } from '../Editor/editorOptions';
import { defineCustomThemes } from '../Editor/editorThemes';
import { toOneLine } from './startPromptModel';

configureMonaco();

type EditorInstance = Parameters<OnMount>[0];

const FONT_SIZE = 20;
const LINE_HEIGHT = 32;
// Enter yields to Monaco's own widgets, so it still accepts a suggestion.
const SUBMIT_WHEN =
  'editorTextFocus && !suggestWidgetVisible && !renameInputVisible && !inlineSuggestionVisible';

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
  scrollbar: {
    vertical: 'hidden',
    horizontal: 'hidden',
    alwaysConsumeMouseWheel: false,
    handleMouseWheel: false,
  },
  scrollBeyondLastColumn: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  occurrencesHighlight: 'off',
  selectionHighlight: false,
  matchBrackets: 'never',
  bracketPairColorization: { enabled: false },
  guides: { indentation: false, bracketPairs: false },
  contextmenu: false,
  // Tab moves focus on, as in any one-line field.
  tabFocusMode: true,
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
  const editorRef = useRef<EditorInstance | null>(null);
  const callbacks = useRef({ onChange, onSubmit, onTextWidth });
  useEffect(() => {
    callbacks.current = { onChange, onSubmit, onTextWidth };
  }, [onChange, onSubmit, onTextWidth]);

  const options = useMemo(
    () => ({
      ...getSatelliteEditorOptions({ fontSize: FONT_SIZE, fontFamily, ariaLabel }),
      ...ONE_LINE_OPTIONS,
      placeholder,
    }),
    [fontFamily, ariaLabel, placeholder]
  );

  const handleBeforeMount = useCallback(
    (monaco: Monaco) => {
      defineCustomThemes(monaco);
      void registerLanguageOnce(monaco, monacoLanguage);
    },
    [monacoLanguage]
  );

  const handleChange = useCallback(
    (next: string | undefined) => callbacks.current.onChange(next ?? ''),
    []
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      const submit = () => callbacks.current.onSubmit();
      editor.addCommand(monaco.KeyCode.Enter, submit, SUBMIT_WHEN);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, submit, SUBMIT_WHEN);
      // Read from the rendered line so tabs, wide characters and any font measure true.
      let frame = 0;
      const measure = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const model = editor.getModel();
          if (!model) return;
          const end = model.getLineMaxColumn(1);
          const offset = editor.getOffsetForColumn(1, end);
          const charWidth = editor.getOption(
            monaco.editor.EditorOption.fontInfo
          ).typicalHalfwidthCharacterWidth;
          callbacks.current.onTextWidth(offset >= 0 ? offset : (end - 1) * charWidth);
        });
      };
      // A drop can still bring line breaks; undo must be able to step back through it.
      editor.onDidChangeModelContent(event => {
        const model = editor.getModel();
        if (model && model.getLineCount() > 1 && !event.isUndoing && !event.isRedoing) {
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
      editor.onDidDispose(() => {
        cancelAnimationFrame(frame);
        editorRef.current = null;
      });
      measure();
      onReady(() => editor.focus());
    },
    [onReady]
  );

  // Pasted line breaks become spaces in the paste itself, so one undo removes it.
  const handlePaste = useCallback((event: ClipboardEvent) => {
    const editor = editorRef.current;
    const text = event.clipboardData.getData('text/plain');
    if (!editor || !/[\r\n]/.test(text)) return;
    event.preventDefault();
    event.stopPropagation();
    editor.trigger('keyboard', 'paste', { text: toOneLine(text), pasteOnNewLine: false, multicursorText: null, mode: null });
  }, []);

  return (
    <div onPasteCapture={handlePaste}>
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
    </div>
  );
}
