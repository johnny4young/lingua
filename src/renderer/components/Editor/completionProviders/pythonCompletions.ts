import type { Monaco } from '@monaco-editor/react';
import { createCompletionProvider } from './providerUtils';

const PYTHON_COMPLETIONS = [
  { label: 'import', detail: 'Python keyword' },
  { label: 'from', detail: 'Python keyword' },
  { label: 'if', detail: 'Python keyword' },
  { label: 'elif', detail: 'Python keyword' },
  { label: 'else', detail: 'Python keyword' },
  { label: 'for', detail: 'Python keyword' },
  { label: 'while', detail: 'Python keyword' },
  { label: 'try', detail: 'Python keyword' },
  { label: 'except', detail: 'Python keyword' },
  { label: 'finally', detail: 'Python keyword' },
  { label: 'with', detail: 'Python keyword' },
  { label: 'async', detail: 'Python keyword' },
  { label: 'await', detail: 'Python keyword' },
  { label: 'return', detail: 'Python keyword' },
  { label: 'pass', detail: 'Python keyword' },
  { label: 'print', detail: 'Write a value to stdout' },
  { label: 'len', detail: 'Return object length' },
  { label: 'range', detail: 'Generate integer ranges' },
  { label: 'enumerate', detail: 'Iterate with index and value' },
  { label: 'zip', detail: 'Iterate multiple collections together' },
  {
    label: 'def',
    kind: 'snippet',
    detail: 'Python function definition',
    insertText: ['def ${1:name}(${2:args}):', '    ${0:pass}'].join('\n'),
  },
  {
    label: 'class',
    kind: 'snippet',
    detail: 'Python class definition',
    insertText: ['class ${1:Name}:', '    def __init__(self, ${2:args}):', '        ${0:pass}'].join('\n'),
  },
  {
    label: "if __name__ == '__main__'",
    kind: 'snippet',
    detail: 'Python module entrypoint',
    insertText: ["if __name__ == '__main__':", '    ${0:main()}'].join('\n'),
  },
] as const;

export function createPythonCompletionProvider(monaco: Monaco) {
  // No explicit trigger characters — Monaco already requests suggestions on
  // alphanumeric input, and triggering on space would surface the entire
  // keyword list after every whitespace keystroke which is noisy in practice.
  return createCompletionProvider(monaco, PYTHON_COMPLETIONS);
}
