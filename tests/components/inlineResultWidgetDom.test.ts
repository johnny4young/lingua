import { describe, expect, it } from 'vitest';
import { createInlineResultNode, inferKind } from '@/components/Editor/inlineResultWidgetDom';
import { isHiddenUndefinedLineResult } from '@/hooks/inlineResultVisibility';

describe('inline result widget shell', () => {
  it('builds an empty shell for the answers to portal into', () => {
    const root = createInlineResultNode(4);
    expect(root.dataset.testid).toBe('lingua-inline-result');
    expect(root.dataset.line).toBe('4');
    expect(root.children).toHaveLength(0);
  });

  it('keeps the hideUndefined filter aligned with inline widget semantics', () => {
    expect(isHiddenUndefinedLineResult({ line: 1, value: 'undefined', type: 'result' })).toBe(true);
    expect(isHiddenUndefinedLineResult({ line: 2, value: 'undefined', type: 'autoLog' })).toBe(true);
    expect(isHiddenUndefinedLineResult({ line: 3, value: 'undefined', type: 'watch' })).toBe(false);
    expect(isHiddenUndefinedLineResult({ line: 4, value: 'undefined', type: 'magic' })).toBe(false);
  });

  it('infers a kind from printed text', () => {
    expect(['1', 'true', '[1]', '{}', 'null', 'x'].map(inferKind)).toEqual(['number', 'boolean', 'array', 'object', 'null', 'string']);
  });
});
