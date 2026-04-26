import type { Monaco } from '@monaco-editor/react';

export function defineCustomThemes(monaco: Monaco) {
  // Lingua Dark — DS canonical syntax palette + chrome from
  // tokens.json (Signal-Slate v1.0.0). The hexes are the OKLCh values
  // declared in lingua/project/handoff/tokens.json under
  // color.syntax.* and color.editor.*, converted to sRGB via the
  // standard OKLab→linear-RGB→sRGB chain. Every foreground passes
  // WCAG AA against #060a0b (the editor.background); the gate in
  // tests/components/Editor/editorThemes.test.ts enforces it.
  //
  // The palette intentionally uses TWO warm hues (number=80 amber,
  // function=285 violet) and one green (string=155) on top of the
  // cool slate base — the multi-hue approach is part of the DS spec
  // and gives the eye more to lock onto when scanning a function
  // body than a strictly cool-leaning palette would.
  monaco.editor.defineTheme('lingua-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6d7e81', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7caaff' },
      { token: 'string', foreground: '63d18f' },
      { token: 'number', foreground: 'f3b94c' },
      { token: 'type', foreground: 'afa9ff' },
      { token: 'function', foreground: 'afa9ff' },
      { token: 'variable', foreground: 'dfe6e7' },
      { token: 'operator', foreground: '98a8ab' },
    ],
    colors: {
      'editor.background': '#060a0b',
      'editor.foreground': '#dfe6e7',
      'editorLineNumber.foreground': '#475558',
      'editorLineNumber.activeForeground': '#98a8ab',
      'editor.lineHighlightBackground': '#0d1314',
      'editor.selectionBackground': '#003d4980',
      'editorCursor.foreground': '#00bfdf',
    },
  });

  // Lingua Light — DS canonical light counterpart. Same syntax roles
  // re-pitched for the light canvas at hue 210 (cool blue-teal). The
  // Signal-Slate accent hue 210 produces a saturated teal cursor,
  // which is the brand mark for the editor in light mode just as the
  // sky-blue cursor is in dark mode.
  monaco.editor.defineTheme('lingua-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7c898b', fontStyle: 'italic' },
      { token: 'keyword', foreground: '2249b7' },
      { token: 'string', foreground: '007338' },
      { token: 'number', foreground: '9e6400' },
      { token: 'type', foreground: '5d52b4' },
      { token: 'function', foreground: '5d52b4' },
      { token: 'variable', foreground: '2a3537' },
      { token: 'operator', foreground: '4a585b' },
    ],
    colors: {
      'editor.background': '#fafcfd',
      'editor.foreground': '#2a3537',
      'editorLineNumber.foreground': '#9ea6a8',
      'editorLineNumber.activeForeground': '#4a585b',
      'editor.lineHighlightBackground': '#f1f5f6',
      'editor.selectionBackground': '#a1e5f180',
      'editorCursor.foreground': '#0080a1',
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
