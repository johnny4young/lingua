import MonacoEditor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { useCallback } from 'react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import type { Language } from '../../types';
import { extensionForLanguage, languageBadgeClass, monacoLanguageFor } from '../../utils/languageMeta';
import { configureMonaco } from '../../monaco';
import { Kbd } from '../ui/chrome';

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
    <div className="relative flex h-full flex-col overflow-auto">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_top,rgba(144,103,255,0.18),transparent_68%)]" />

      <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col justify-center gap-8 px-5 py-8 sm:px-8 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10">
        <section className="animate-rise-in space-y-7">
          <div className="inline-flex items-center gap-3">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-[1.4rem] border border-border-strong/80 bg-surface-strong/90 shadow-[0_18px_60px_rgba(12,14,24,0.18)]">
              <span className="font-display text-xl font-semibold tracking-[0.14em] text-primary">
                RL
              </span>
              <span className="absolute inset-1 rounded-[1.1rem] border border-white/6" />
            </div>
            <div>
              <p className="panel-title">Developer Workbench</p>
              <h1 className="font-display text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">
                RunLang
              </h1>
            </div>
          </div>

          <div className="max-w-2xl space-y-3">
            <p className="max-w-xl text-balance font-display text-[1.95rem] font-semibold leading-tight tracking-[-0.04em] text-foreground sm:text-[2.45rem]">
              Run experiments fast, keep the workspace calm, and stay inside one editor.
            </p>
            <p className="max-w-xl text-sm leading-7 text-muted sm:text-base">
              Start a blank file, open a language template, or jump straight to a snippet.
              The shell is tuned for tight feedback loops and native desktop execution when
              you need it.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {LANGUAGE_ORDER.map((language) => (
              <button
                key={language}
                onClick={() => quickStart(language)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition-transform hover:-translate-y-0.5 ${languageBadgeClass(language)}`}
              >
                {language === 'javascript'
                  ? 'JavaScript'
                  : language === 'typescript'
                    ? 'TypeScript'
                    : language.charAt(0).toUpperCase() + language.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted">
            <span>
              <Kbd>Cmd+Shift+P</Kbd> Commands
            </span>
            <span>
              <Kbd>Cmd+B</Kbd> Sidebar
            </span>
            <span>
              <Kbd>Cmd+Enter</Kbd> Run
            </span>
          </div>
        </section>

        <section className="surface-panel-strong animate-rise-in overflow-hidden">
          <div className="surface-header flex items-center justify-between px-5 py-4">
            <div>
              <p className="panel-title">Starting Points</p>
              <p className="mt-1 text-sm text-muted">Open a proven template and iterate.</p>
            </div>
            <div className="status-pill">9 templates</div>
          </div>

          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {BUILT_IN_TEMPLATES.slice(0, 6).map((template) => (
              <button
                key={template.id}
                onClick={() => openTemplate(template.id)}
                className="group flex flex-col gap-2 rounded-[1.35rem] border border-border/80 bg-background-elevated/74 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-border-strong/90 hover:bg-background-elevated"
              >
                <span
                  className={`self-start rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${languageBadgeClass(template.language)}`}
                >
                  {template.language}
                </span>
                <span className="font-display text-lg font-semibold tracking-[-0.03em] text-foreground">
                  {template.label}
                </span>
                <span className="text-xs leading-6 text-muted">{template.description}</span>
              </button>
            ))}
          </div>
        </section>
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
