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
});
