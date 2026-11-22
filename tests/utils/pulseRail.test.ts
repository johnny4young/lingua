import { describe, expect, it } from 'vitest';
import { buildPulseRail, isQuietRailLine, PULSE_RAIL_SLOTS, type PulseRailInput } from '@/utils/pulseRail';

const lines = [
  'function quickSort(arr) {', // 1
  '  if (arr.length <= 1) return arr;', // 2
  '  return arr;', // 3
  '}', // 4
  '', // 5
  '// sort it', // 6
  'const nums = [3, 1];', // 7
  'console.log(quickSort(nums));', // 8
  '', // 9
];

function rail(input: Partial<PulseRailInput>) {
  const built = buildPulseRail({ lines, executed: [], complete: false, frontier: null, finished: false, ...input });
  return Object.fromEntries(built.map(line => [line.line, line.state]));
}

describe('buildPulseRail', () => {
  it('draws nothing before a run reached any line', () => {
    expect(buildPulseRail({ lines, executed: [], complete: false, frontier: null, finished: true })).toEqual([]);
  });

  it('ticks answered lines and lights the rest of a finished run, stopping at the last code line', () => {
    expect(rail({ executed: [8], finished: true })).toEqual({
      1: 'reached',
      2: 'reached',
      3: 'reached',
      4: 'reached',
      5: 'reached',
      6: 'reached',
      7: 'reached',
      8: 'answered',
    });
  });

  it('dots everything below the line that threw and crosses that line', () => {
    expect(rail({ executed: [2, 8], frontier: { line: 7, kind: 'raised' } })).toMatchObject({
      2: 'answered',
      6: 'reached',
      7: 'raised',
      8: 'not-run',
    });
  });

  it('stops a run that did not finish at its last answer', () => {
    expect(rail({ executed: [2] })).toMatchObject({ 1: 'reached', 2: 'answered', 3: 'not-run', 8: 'not-run' });
  });

  it('with every timeline step, lights only quiet gaps and dots code that never ran', () => {
    expect(rail({ executed: [7, 8, 2, 3], complete: true })).toEqual({
      1: 'not-run',
      2: 'answered',
      3: 'answered',
      4: 'reached',
      5: 'reached',
      6: 'reached',
      7: 'answered',
      8: 'answered',
    });
  });

  it('beats on the selected step and dots the steps after it', () => {
    expect(rail({ executed: [7, 8], complete: true, frontier: { line: 2, kind: 'running' } })).toMatchObject({
      2: 'running',
      3: 'not-run',
      7: 'answered',
      8: 'answered',
    });
  });

  it('holds the paused line without a tick', () => {
    expect(rail({ executed: [7], frontier: { line: 8, kind: 'paused' } })).toMatchObject({ 7: 'answered', 8: 'paused' });
  });

  it('keeps a region run inside its region', () => {
    const built = rail({ executed: [8], finished: true, span: { start: 6, end: 9 } });
    expect(Object.keys(built).map(Number)).toEqual([6, 7, 8]);
  });

  it('ignores lines outside the file', () => {
    expect(rail({ executed: [0, 40], frontier: { line: 99, kind: 'raised' } })).toEqual({});
  });

  it('spreads the travel over the lit lines from top to bottom', () => {
    const built = buildPulseRail({ lines, executed: [8], complete: false, frontier: null, finished: true });
    expect(built[0]!.slot).toBe(0);
    expect(built.at(-1)!.slot).toBe(PULSE_RAIL_SLOTS - 1);
    const notRun = buildPulseRail({ lines, executed: [2], complete: false, frontier: null, finished: false });
    expect(notRun.find(line => line.state === 'not-run')!.slot).toBeNull();
  });
});

describe('isQuietRailLine', () => {
  it('treats blanks, comments and closing brackets as quiet', () => {
    for (const text of ['', '   ', '// note', '# note', '/* a', ' * b', '}', '  ]);', ')']) {
      expect(isQuietRailLine(text)).toBe(true);
    }
    for (const text of ['x = 1', 'print(x)', '} else {', 'return']) expect(isQuietRailLine(text)).toBe(false);
  });
});
