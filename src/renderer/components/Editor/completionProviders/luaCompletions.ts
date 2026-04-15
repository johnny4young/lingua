import type { Monaco } from '@monaco-editor/react';
import { createCompletionProvider } from './providerUtils';

const LUA_COMPLETIONS = [
  { label: 'local', detail: 'Lua keyword' },
  { label: 'function', detail: 'Lua keyword' },
  { label: 'end', detail: 'Lua keyword' },
  { label: 'if', detail: 'Lua keyword' },
  { label: 'then', detail: 'Lua keyword' },
  { label: 'elseif', detail: 'Lua keyword' },
  { label: 'else', detail: 'Lua keyword' },
  { label: 'while', detail: 'Lua keyword' },
  { label: 'repeat', detail: 'Lua keyword' },
  { label: 'until', detail: 'Lua keyword' },
  { label: 'do', detail: 'Lua keyword' },
  { label: 'return', detail: 'Lua keyword' },
  { label: 'print', detail: 'Write a value to stdout' },
  { label: 'pairs', detail: 'Iterate key/value pairs' },
  { label: 'ipairs', detail: 'Iterate array-style tables' },
  { label: 'require', detail: 'Load a Lua module' },
  { label: 'table.insert', detail: 'Insert into a table' },
  { label: 'table.remove', detail: 'Remove from a table' },
  { label: 'string.format', detail: 'Format a string' },
  { label: 'io.write', detail: 'Write to standard output' },
  {
    label: 'for',
    kind: 'snippet',
    detail: 'Lua numeric for loop',
    insertText: ['for ${1:i} = 1, ${2:n} do', '  ${0}', 'end'].join('\n'),
  },
  {
    label: 'for ipairs',
    kind: 'snippet',
    detail: 'Lua array iteration',
    insertText: [
      'for ${1:index}, ${2:value} in ipairs(${3:items}) do',
      '  ${0}',
      'end',
    ].join('\n'),
  },
  {
    label: 'function',
    kind: 'snippet',
    detail: 'Lua function declaration',
    insertText: [
      'function ${1:name}(${2:args})',
      '  ${0}',
      'end',
    ].join('\n'),
  },
] as const;

export function createLuaCompletionProvider(monaco: Monaco) {
  return createCompletionProvider(monaco, LUA_COMPLETIONS, {
    triggerCharacters: ['.'],
  });
}
