import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback } from 'react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import type { Language } from '../../types';
import { extensionForLanguage, languageBadgeClass, monacoLanguageFor } from '../../utils/languageMeta';
import { configureMonaco } from '../../monaco';

configureMonaco();

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

// Group templates by language for the welcome screen
const LANGUAGE_ORDER: Language[] = ['javascript', 'typescript', 'go', 'python', 'rust'];

function EmptyState() {
  const { addTab } = useEditorStore();

  const openTemplate = (tplId: string) => {
    const tpl = BUILT_IN_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    const tab = createDefaultTab(tpl.language);
    addTab({ ...tab, content: tpl.code, name: `${tpl.label}.${extensionForLanguage(tpl.language)}` });
  };

  const quickStart = (language: Language) => {
    const tab = createDefaultTab(language);
    addTab(tab);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8 text-center">
      {/* Logo / brand */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15">
            <span className="text-lg font-bold text-primary-400">R</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-100">RunLang</h1>
        </div>
        <p className="max-w-sm text-sm text-gray-500">
          Write, run, and experiment with code instantly.
        </p>
      </div>

      {/* Quick-start language buttons */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {LANGUAGE_ORDER.map((lang) => (
          <button
            key={lang}
            onClick={() => quickStart(lang)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:scale-105 ${languageBadgeClass(lang)}`}
          >
            {lang === 'javascript' ? 'JavaScript' : lang === 'typescript' ? 'TypeScript' : lang.charAt(0).toUpperCase() + lang.slice(1)}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="w-full max-w-2xl">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-600">
          Or start from a template
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BUILT_IN_TEMPLATES.slice(0, 9).map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => openTemplate(tpl.id)}
              className="group flex flex-col gap-1.5 rounded-lg border border-gray-800/60 bg-gray-900/50 p-3 text-left transition-all hover:border-gray-700 hover:bg-gray-800/60"
            >
              <span className={`self-start rounded px-1.5 py-0.5 text-[10px] font-bold ${languageBadgeClass(tpl.language)}`}>
                {tpl.language}
              </span>
              <span className="text-xs font-medium text-gray-300 group-hover:text-gray-100">{tpl.label}</span>
              <span className="text-[11px] leading-tight text-gray-600">{tpl.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Shortcuts hint */}
      <div className="flex items-center gap-4 text-[11px] text-gray-600">
        <span>
          <kbd className="rounded bg-gray-800/80 px-1.5 py-0.5 text-gray-500">Cmd+Shift+P</kbd> Commands
        </span>
        <span>
          <kbd className="rounded bg-gray-800/80 px-1.5 py-0.5 text-gray-500">Cmd+B</kbd> Sidebar
        </span>
        <span>
          <kbd className="rounded bg-gray-800/80 px-1.5 py-0.5 text-gray-500">Cmd+Enter</kbd> Run
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CodeEditor() {
  const { tabs, activeTabId, updateContent } = useEditorStore();
  const { editorTheme, fontSize, fontFamily, showLineNumbers, wordWrap, minimap } =
    useSettingsStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Sync scroll with ResultPanel
  const handleEditorMount: OnMount = useCallback((editor) => {
    editor.onDidScrollChange((e) => {
      window.dispatchEvent(
        new CustomEvent('runlang:editor-scroll', {
          detail: { scrollTop: e.scrollTop },
        })
      );
    });
  }, []);

  if (!activeTab) {
    return <EmptyState />;
  }

  return (
    <MonacoEditor
      height="100%"
      language={monacoLanguageFor(activeTab.language)}
      value={activeTab.content}
      theme={editorTheme}
      beforeMount={defineCustomThemes}
      onMount={handleEditorMount}
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
