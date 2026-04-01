import MonacoEditor from '@monaco-editor/react';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Language } from '../../types';

const LANGUAGE_MAP: Record<Language, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  go: 'go',
  python: 'python',
  rust: 'rust',
};

export function CodeEditor() {
  const { tabs, activeTabId, updateContent } = useEditorStore();
  const { editorTheme, fontSize, fontFamily, showLineNumbers, wordWrap, minimap } =
    useSettingsStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        No file open. Create a new tab to start coding.
      </div>
    );
  }

  return (
    <MonacoEditor
      height="100%"
      language={LANGUAGE_MAP[activeTab.language]}
      value={activeTab.content}
      theme={editorTheme}
      onChange={(value) => {
        if (value !== undefined) {
          updateContent(activeTab.id, value);
        }
      }}
      options={{
        fontSize,
        fontFamily,
        lineNumbers: showLineNumbers ? 'on' : 'off',
        wordWrap: wordWrap ? 'on' : 'off',
        minimap: { enabled: minimap },
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        renderLineHighlight: 'line',
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        formatOnPaste: true,
        tabSize: 2,
      }}
    />
  );
}
