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

  // internal overflow Prerequisite fix (landed in the implementation
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

    it('leaves internal typed-payload summaries alone — they ship under the cap', () => {
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

describe('internal — inline timing chip', () => {
  it('renders the timing chip after the value parts', () => {
    const node = renderInlineResultNode(
      [{ line: 1, value: '42', type: 'autoLog' }],
      { durationMs: 320.4, slowest: false }
    );
    const chip = node.querySelector('[data-testid="lingua-inline-timing"]');
    expect(chip?.textContent).toBe('▸ 320 ms');
    expect(chip?.getAttribute('data-slowest')).toBeNull();
  });

  it('marks the slowest statement and keeps sub-100ms precision', () => {
    const node = renderInlineResultNode([], { durationMs: 1.26, slowest: true });
    const chip = node.querySelector('[data-testid="lingua-inline-timing"]');
    expect(chip?.textContent).toBe('▸ 1.3 ms');
    expect(chip?.getAttribute('data-slowest')).toBe('true');
    // A timing-only line renders no value parts at all.
    expect(node.querySelectorAll('.lingua-inline-result-part')).toHaveLength(0);
  });

  it('renders no chip when the run was not instrumented', () => {
    const node = renderInlineResultNode([{ line: 1, value: 'x', type: 'magic' }]);
    expect(node.querySelector('[data-testid="lingua-inline-timing"]')).toBeNull();
  });
});
