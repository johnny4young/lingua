import { describe, expect, it } from 'vitest';
import { testsMeterBars } from '../../../src/renderer/components/ProjectTests/testsMeterModel';

describe('testsMeterBars', () => {
  it('stacks the failed share over the passed share and marks the newest run', () => {
    const bars = testsMeterBars([
      { kind: 'success', passed: 6, failed: 0 },
      { kind: 'failed', passed: 5, failed: 1 },
    ]);
    expect(bars.map(bar => [bar.failed, bar.empty, bar.latest])).toEqual([
      [0, false, false],
      [1 / 6, false, true],
    ]);
  });

  it('draws a run that counted no tests as an empty stub', () => {
    const [bar] = testsMeterBars([{ kind: 'timed-out', passed: 0, failed: 0 }]);
    expect(bar).toMatchObject({ failed: 0, empty: true, latest: true });
  });

  it('has no bars before the first whole-project run', () => {
    expect(testsMeterBars([])).toEqual([]);
  });
});
