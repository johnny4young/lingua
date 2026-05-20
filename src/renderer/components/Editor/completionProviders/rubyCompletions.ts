import type { Monaco } from '@monaco-editor/react';
import { analyzeRubyLanguageIntelligence } from '../../../languageIntelligence/ruby';
import { createCompletionProvider } from './providerUtils';

const RUBY_COMPLETIONS = [
  { label: 'require', detail: 'Ruby keyword' },
  { label: 'include', detail: 'Ruby module mixin' },
  { label: 'extend', detail: 'Ruby module mixin' },
  { label: 'attr_reader', detail: 'Define reader methods' },
  { label: 'attr_writer', detail: 'Define writer methods' },
  { label: 'attr_accessor', detail: 'Define reader and writer methods' },
  { label: 'initialize', detail: 'Ruby object initializer' },
  { label: 'puts', detail: 'Write a line to stdout' },
  { label: 'print', detail: 'Write text to stdout' },
  { label: 'p', detail: 'Inspect and print a value' },
  { label: 'raise', detail: 'Raise an exception' },
  { label: 'rescue', detail: 'Handle an exception' },
  { label: 'ensure', detail: 'Run cleanup after begin/rescue' },
  { label: 'yield', detail: 'Yield to the current block' },
  { label: 'map', detail: 'Transform each enumerable item' },
  { label: 'each', detail: 'Iterate each enumerable item' },
  { label: 'select', detail: 'Filter enumerable items' },
  { label: 'reject', detail: 'Reject enumerable items' },
  { label: 'sort_by', detail: 'Sort enumerable items by a block value' },
  {
    label: 'def',
    kind: 'snippet',
    detail: 'Ruby method definition',
    insertText: ['def ${1:name}(${2:args})', '  ${0:nil}', 'end'].join('\n'),
  },
  {
    label: 'class',
    kind: 'snippet',
    detail: 'Ruby class definition',
    insertText: [
      'class ${1:Name}',
      '  def initialize(${2:args})',
      '    ${0:nil}',
      '  end',
      'end',
    ].join('\n'),
  },
  {
    label: 'module',
    kind: 'snippet',
    detail: 'Ruby module definition',
    insertText: ['module ${1:Name}', '  ${0:nil}', 'end'].join('\n'),
  },
  {
    label: 'do |item|',
    kind: 'snippet',
    detail: 'Ruby block',
    insertText: ['do |${1:item}|', '  ${0:item}', 'end'].join('\n'),
  },
  {
    label: 'if',
    kind: 'snippet',
    detail: 'Ruby conditional',
    insertText: ['if ${1:condition}', '  ${0:nil}', 'end'].join('\n'),
  },
  {
    label: 'begin/rescue',
    kind: 'snippet',
    detail: 'Ruby exception handling',
    insertText: [
      'begin',
      '  ${1:work}',
      'rescue ${2:StandardError} => ${3:error}',
      '  ${0:warn error.message}',
      'end',
    ].join('\n'),
  },
] as const;

export function createRubyCompletionProvider(monaco: Monaco) {
  return createCompletionProvider(monaco, RUBY_COMPLETIONS, {
    triggerCharacters: [' ', '.', '@', ':'],
    getDynamicDefinitions: model =>
      analyzeRubyLanguageIntelligence(model.getValue()).completions,
  });
}
