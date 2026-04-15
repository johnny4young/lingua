import type { Monaco } from '@monaco-editor/react';
import { createCompletionProvider } from './providerUtils';

const GO_COMPLETIONS = [
  { label: 'package', detail: 'Go keyword' },
  { label: 'import', detail: 'Go keyword' },
  { label: 'var', detail: 'Go keyword' },
  { label: 'const', detail: 'Go keyword' },
  { label: 'type', detail: 'Go keyword' },
  { label: 'struct', detail: 'Go keyword' },
  { label: 'interface', detail: 'Go keyword' },
  { label: 'defer', detail: 'Go keyword' },
  { label: 'go', detail: 'Go keyword' },
  { label: 'select', detail: 'Go keyword' },
  { label: 'switch', detail: 'Go keyword' },
  { label: 'case', detail: 'Go keyword' },
  { label: 'return', detail: 'Go keyword' },
  { label: 'fmt.Println', detail: 'Write a line to stdout' },
  { label: 'fmt.Sprintf', detail: 'Build a formatted string' },
  { label: 'make', detail: 'Create slices, maps, and channels' },
  { label: 'len', detail: 'Return collection length' },
  { label: 'append', detail: 'Append items to a slice' },
  {
    label: 'func',
    kind: 'snippet',
    detail: 'Go function declaration',
    insertText: ['func ${1:name}(${2:args}) {', '\t${0}', '}'].join('\n'),
  },
  {
    label: 'if err != nil',
    kind: 'snippet',
    detail: 'Go error guard',
    insertText: ['if err != nil {', '\treturn ${0:err}', '}'].join('\n'),
  },
  {
    label: 'for range',
    kind: 'snippet',
    detail: 'Go range loop',
    insertText: [
      'for ${1:index}, ${2:value} := range ${3:collection} {',
      '\t${0}',
      '}',
    ].join('\n'),
  },
] as const;

export function createGoCompletionProvider(monaco: Monaco) {
  return createCompletionProvider(monaco, GO_COMPLETIONS, {
    triggerCharacters: ['.'],
  });
}
