import type { Monaco } from '@monaco-editor/react';

export function defineCustomThemes(monaco: Monaco) {
  // Lingua Dark — Signal-Slate syntax palette on top of the existing
  // GitHub-dark-inspired chrome. Cool-leaning family: violet keywords,
  // mint strings, sky numbers, teal types, blue functions, slate glue.
  // Intentionally avoids Dracula-pink and Monokai-fuchsia so the theme
  // reads as Lingua's own identity, not a third-party port. Every
  // foreground passes WCAG AA (≥ 4.5:1) against the #0d1117 background;
  // the tests/components/editorThemes.test.ts contrast gate enforces it.
  monaco.editor.defineTheme('lingua-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7a8699', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a78bfa' },
      { token: 'string', foreground: '7ee9b4' },
      { token: 'number', foreground: '7dd3fc' },
      { token: 'type', foreground: '5eead4' },
      { token: 'function', foreground: '93c5fd' },
      { token: 'variable', foreground: 'e2e8f0' },
      { token: 'operator', foreground: '94a3b8' },
    ],
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

  // Lingua Light — light counterpart of lingua-dark. Same cool-slate
  // family re-pitched for a light canvas: deeper violets, teals, and
  // emeralds so they stay readable on #f6f8fa. Enables the "sync shell
  // with editor theme" flow to land on a Lingua-owned light theme
  // instead of forcing users onto vs (Microsoft) or solarized-light.
  monaco.editor.defineTheme('lingua-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '556b7d', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7c3aed' },
      { token: 'string', foreground: '047857' },
      { token: 'number', foreground: '0369a1' },
      { token: 'type', foreground: '0f766e' },
      { token: 'function', foreground: '1d4ed8' },
      { token: 'variable', foreground: '1e293b' },
      { token: 'operator', foreground: '475569' },
    ],
    colors: {
      'editor.background': '#f6f8fa',
      'editor.foreground': '#1e293b',
      'editorLineNumber.foreground': '#94a3b8',
      'editorLineNumber.activeForeground': '#475569',
      'editor.lineHighlightBackground': '#eef2f7',
      'editor.selectionBackground': '#cde7ff80',
      'editorCursor.foreground': '#2563eb',
    },
  });

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

  monaco.editor.defineTheme('nord-night', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
      { token: 'keyword', foreground: '81a1c1' },
      { token: 'string', foreground: 'a3be8c' },
      { token: 'number', foreground: 'b48ead' },
      { token: 'type', foreground: '8fbcbb' },
      { token: 'function', foreground: '88c0d0' },
      { token: 'variable', foreground: 'd8dee9' },
    ],
    colors: {
      'editor.background': '#2e3440',
      'editor.foreground': '#d8dee9',
      'editorLineNumber.foreground': '#4c566a',
      'editorLineNumber.activeForeground': '#d8dee9',
      'editor.lineHighlightBackground': '#3b4252',
      'editor.selectionBackground': '#434c5e',
      'editorCursor.foreground': '#88c0d0',
    },
  });

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
