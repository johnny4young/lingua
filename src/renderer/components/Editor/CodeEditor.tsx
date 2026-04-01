import MonacoEditor, { type Monaco } from '@monaco-editor/react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import type { Language } from '../../types';

const LANGUAGE_MAP: Record<Language, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  go: 'go',
  python: 'python',
  rust: 'rust',
};

// ---------------------------------------------------------------------------
// Custom theme definitions
// ---------------------------------------------------------------------------

function defineCustomThemes(monaco: Monaco) {
  // RunLang Dark (default) — a refined dark theme
  monaco.editor.defineTheme('runlang-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#e6edf3',
      'editorLineNumber.foreground': '#3d444d',
      'editorLineNumber.activeForeground': '#6e7681',
      'editor.lineHighlightBackground': '#161b22',
      'editor.selectionBackground': '#264f7840',
      'editorCursor.foreground': '#79c0ff',
    },
  });

  // Dracula
  monaco.editor.defineTheme('dracula', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff79c6' },
      { token: 'string', foreground: 'f1fa8c' },
      { token: 'number', foreground: 'bd93f9' },
      { token: 'type', foreground: '8be9fd' },
      { token: 'function', foreground: '50fa7b' },
      { token: 'variable', foreground: 'f8f8f2' },
    ],
    colors: {
      'editor.background': '#282a36',
      'editor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#6272a4',
      'editor.lineHighlightBackground': '#44475a40',
      'editor.selectionBackground': '#44475a',
      'editorCursor.foreground': '#f8f8f2',
    },
  });

  // One Dark Pro
  monaco.editor.defineTheme('one-dark-pro', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c678dd' },
      { token: 'string', foreground: '98c379' },
      { token: 'number', foreground: 'd19a66' },
      { token: 'type', foreground: 'e5c07b' },
      { token: 'function', foreground: '61afef' },
      { token: 'variable', foreground: 'e06c75' },
    ],
    colors: {
      'editor.background': '#282c34',
      'editor.foreground': '#abb2bf',
      'editorLineNumber.foreground': '#4b5263',
      'editor.lineHighlightBackground': '#2c313c',
      'editor.selectionBackground': '#3e4451',
      'editorCursor.foreground': '#528bff',
    },
  });

  // Monokai
  monaco.editor.defineTheme('monokai', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'f92672' },
      { token: 'string', foreground: 'e6db74' },
      { token: 'number', foreground: 'ae81ff' },
      { token: 'type', foreground: '66d9e8' },
      { token: 'function', foreground: 'a6e22e' },
      { token: 'variable', foreground: 'f8f8f2' },
    ],
    colors: {
      'editor.background': '#272822',
      'editor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#75715e',
      'editor.lineHighlightBackground': '#3e3d32',
      'editor.selectionBackground': '#49483e',
      'editorCursor.foreground': '#f8f8f0',
    },
  });

  // Solarized Light
  monaco.editor.defineTheme('solarized-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
      { token: 'keyword', foreground: '859900' },
      { token: 'string', foreground: '2aa198' },
      { token: 'number', foreground: 'd33682' },
      { token: 'type', foreground: 'cb4b16' },
      { token: 'function', foreground: '268bd2' },
    ],
    colors: {
      'editor.background': '#fdf6e3',
      'editor.foreground': '#657b83',
      'editorLineNumber.foreground': '#93a1a1',
      'editor.lineHighlightBackground': '#eee8d5',
      'editor.selectionBackground': '#eee8d5',
      'editorCursor.foreground': '#657b83',
    },
  });
}

// ---------------------------------------------------------------------------
// Empty state — example gallery
// ---------------------------------------------------------------------------

const FEATURED_TEMPLATES = BUILT_IN_TEMPLATES.slice(0, 6); // show first 6 across languages

const LANG_BADGE: Record<Language, string> = {
  javascript: 'bg-yellow-500/15 text-yellow-400',
  typescript: 'bg-blue-500/15 text-blue-400',
  go:         'bg-cyan-500/15 text-cyan-400',
  python:     'bg-green-500/15 text-green-400',
  rust:       'bg-orange-500/15 text-orange-400',
};

function EmptyState() {
  const { addTab } = useEditorStore();

  const openTemplate = (tplId: string) => {
    const tpl = BUILT_IN_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    const tab = createDefaultTab(tpl.language);
    addTab({ ...tab, content: tpl.code, name: `${tpl.label}.${extForLang(tpl.language)}` });
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div>
        <h2 className="text-lg font-semibold text-gray-300">Start coding</h2>
        <p className="mt-1 text-sm text-gray-600">
          Open a file from the sidebar, or pick a template below.
          <br />
          Press <kbd className="rounded bg-gray-800 px-1 py-0.5 text-xs text-gray-400">Cmd+Shift+P</kbd> for more templates.
        </p>
      </div>
      <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-3">
        {FEATURED_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => openTemplate(tpl.id)}
            className="flex flex-col gap-1 rounded-lg border border-gray-800 bg-gray-900 p-3 text-left transition-colors hover:border-gray-600 hover:bg-gray-800"
          >
            <span className={`self-start rounded px-1.5 py-0.5 text-[10px] font-bold ${LANG_BADGE[tpl.language]}`}>
              {tpl.language}
            </span>
            <span className="text-xs font-medium text-gray-300">{tpl.label}</span>
            <span className="text-[11px] text-gray-600 leading-tight">{tpl.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function extForLang(lang: Language): string {
  const map: Record<Language, string> = {
    javascript: 'js', typescript: 'ts', go: 'go', python: 'py', rust: 'rs',
  };
  return map[lang];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeEditor() {
  const { tabs, activeTabId, updateContent } = useEditorStore();
  const { editorTheme, fontSize, fontFamily, showLineNumbers, wordWrap, minimap } =
    useSettingsStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (!activeTab) {
    return <EmptyState />;
  }

  return (
    <MonacoEditor
      height="100%"
      language={LANGUAGE_MAP[activeTab.language]}
      value={activeTab.content}
      theme={editorTheme}
      beforeMount={defineCustomThemes}
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
