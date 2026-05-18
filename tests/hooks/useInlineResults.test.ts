import { describe, expect, it } from 'vitest';
import {
  isHiddenUndefinedLineResult,
  renderInlineResultNode,
} from '@/hooks/useInlineResults';

describe('useInlineResults inline widget DOM', () => {
  it('badges only watch results, not arrow magic results', () => {
    const node = renderInlineResultNode([
      { line: 1, value: 'arrow value', type: 'magic' },
      { line: 2, value: 'pinned value', type: 'watch' },
      { line: 3, value: 'auto value', type: 'autoLog' },
    ]);

    const watchBadges = node.querySelectorAll('.lingua-inline-result-watch');
    expect(watchBadges).toHaveLength(1);
    expect(watchBadges[0]?.textContent).toBe('@WATCH');

    const parts = Array.from(node.querySelectorAll('.lingua-inline-result-part'));
    expect(parts.map((part) => part.textContent)).toEqual([
      '⟸arrow valuestring',
      '@WATCH⟸pinned valuestring',
      '⟸auto valuestring',
    ]);
  });

  it('keeps the hideUndefined filter aligned with inline widget semantics', () => {
    expect(isHiddenUndefinedLineResult({ line: 1, value: 'undefined', type: 'result' }))
      .toBe(true);
    expect(isHiddenUndefinedLineResult({ line: 2, value: 'undefined', type: 'autoLog' }))
      .toBe(true);
    expect(isHiddenUndefinedLineResult({ line: 3, value: 'undefined', type: 'watch' }))
      .toBe(false);
    expect(isHiddenUndefinedLineResult({ line: 4, value: 'undefined', type: 'magic' }))
      .toBe(false);
  });

  // RL-093 overflow Prerequisite fix (landed in the RL-044 Slice 1A
  // commit). Long values used to paint past the editor right edge and
  // wrap onto a second line that overran the gutter; truncate to a
  // fixed cap and surface the full text via `title`.
  describe('long-value truncation', () => {
    it('passes short values through unchanged with no title attribute', () => {
      const node = renderInlineResultNode([{ line: 1, value: 'short', type: 'magic' }]);
      const value = node.querySelector('.lingua-inline-result-value');
      expect(value?.textContent).toBe('short');
      expect(value?.getAttribute('title')).toBeNull();
      expect(value?.getAttribute('data-truncated')).toBeNull();
    });

    it('truncates and tags values that exceed the inline cap', () => {
      const longValue = '[' + 'a'.repeat(200) + ']';
      const node = renderInlineResultNode([{ line: 1, value: longValue, type: 'magic' }]);
      const value = node.querySelector('.lingua-inline-result-value');
      expect(value?.textContent?.length).toBe(80);
      expect(value?.textContent?.endsWith('…')).toBe(true);
      expect(value?.getAttribute('title')).toBe(longValue);
      expect(value?.getAttribute('data-truncated')).toBe('true');
    });

    it('leaves RL-044 typed-payload summaries alone — they ship under the cap', () => {
      const node = renderInlineResultNode([
        {
          line: 1,
          value: '[{"a":1},{"a":2}]',
          type: 'magic',
          payload: {
            kind: 'table',
            columns: ['a'],
            rows: [
              [{ kind: 'primitive', type: 'number', repr: '1' }],
              [{ kind: 'primitive', type: 'number', repr: '2' }],
            ],
          },
        },
      ]);
      const value = node.querySelector('.lingua-inline-result-value');
      expect(value?.textContent).toBe('Table(2×1) — a');
      expect(value?.getAttribute('data-truncated')).toBeNull();
    });
  });
});
