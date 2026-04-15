import type { Monaco } from '@monaco-editor/react';
import { createCompletionProvider } from './providerUtils';

const RUST_COMPLETIONS = [
  { label: 'let', detail: 'Rust keyword' },
  { label: 'mut', detail: 'Rust keyword' },
  { label: 'struct', detail: 'Rust keyword' },
  { label: 'enum', detail: 'Rust keyword' },
  { label: 'trait', detail: 'Rust keyword' },
  { label: 'impl', detail: 'Rust keyword' },
  { label: 'use', detail: 'Rust keyword' },
  { label: 'pub', detail: 'Rust keyword' },
  { label: 'mod', detail: 'Rust keyword' },
  { label: 'crate', detail: 'Rust keyword' },
  { label: 'match', detail: 'Rust keyword' },
  { label: 'async', detail: 'Rust keyword' },
  { label: 'await', detail: 'Rust keyword' },
  { label: 'return', detail: 'Rust keyword' },
  { label: 'vec!', detail: 'Create a vector literal' },
  { label: 'assert_eq!', detail: 'Compare two values in tests' },
  { label: 'dbg!', detail: 'Debug-print a value' },
  {
    label: 'println!',
    kind: 'snippet',
    detail: 'Print a formatted line',
    insertText: 'println!("${1:{}}", ${2:value});',
  },
  {
    label: 'fn main',
    kind: 'snippet',
    detail: 'Rust program entrypoint',
    insertText: ['fn main() {', '    ${0}', '}'].join('\n'),
  },
  {
    // Distinct label from the plain `match` keyword above so Monaco does not
    // surface two entries that share the exact same display text.
    label: 'match expression',
    kind: 'snippet',
    detail: 'Rust match expression',
    insertText: [
      'match ${1:value} {',
      '    ${2:pattern} => ${0:todo!()},',
      '}',
    ].join('\n'),
  },
  {
    label: 'impl',
    kind: 'snippet',
    detail: 'Rust impl block',
    insertText: [
      'impl ${1:Type} {',
      '    fn ${2:new}(${3:args}) -> Self {',
      '        ${0:todo!()}',
      '    }',
      '}',
    ].join('\n'),
  },
  {
    label: 'use std::',
    kind: 'snippet',
    detail: 'Import from the Rust standard library',
    insertText: 'use std::${1:io};',
  },
] as const;

export function createRustCompletionProvider(monaco: Monaco) {
  return createCompletionProvider(monaco, RUST_COMPLETIONS, {
    triggerCharacters: ['!', ':'],
  });
}
