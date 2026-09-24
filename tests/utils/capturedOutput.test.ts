import { describe, expect, it } from 'vitest';
import { orderedConsoleOutputs } from '@/utils/capturedOutput';

describe('captured output ordering', () => {
  it.each([undefined, -1, NaN, 0])(
    'does not invent cross-stream order with missing/invalid/duplicate sequence %s',
    captureOrder => {
      const stdout = [{ type: 'log' as const, args: ['out'], captureOrder: 0 }];
      const stderr = [{ type: 'error' as const, args: ['err'], captureOrder }];
      expect(orderedConsoleOutputs({ stdout, stderr })).toEqual([...stdout, ...stderr]);
    }
  );
  it('sorts observed captures without changing the source arrays', () => {
    const stdout = [{ type: 'log' as const, args: ['out'], captureOrder: 2 }];
    const stderr = [{ type: 'error' as const, args: ['err'], captureOrder: 1 }];
    expect(orderedConsoleOutputs({ stdout, stderr })).toEqual([stderr[0], stdout[0]]);
    expect(stdout).toHaveLength(1);
    expect(stderr).toHaveLength(1);
  });
});
