import { describe, expect, it, vi } from 'vitest';
import { columnSlots, fixedColumnWindow, planColumns, type ColumnGap, type TypedColumn } from '../../../src/renderer/components/SqlWorkspace/sqlGridColumns';

const column = (name: string, duckType = 'VARCHAR', numeric = false, index = 0): TypedColumn => ({ col: { name, type: 'Utf8' }, duckType, numeric, index });
const widthOf = (value: unknown, typed = column('c')) => planColumns([typed], [{ [typed.col.name]: value }], new Set(), undefined).widths[0]!;

describe('planColumns', () => {
  it('holds the table minimums for short values', () => {
    expect(widthOf('a')).toBe(200);
    expect(widthOf(1, column('c', 'BIGINT', true))).toBe(130);
  });

  it('fits a value the way auto layout does, then stops at the cell cap', () => {
    expect(widthOf('x'.repeat(40))).toBe(285);
    expect(widthOf('x'.repeat(5000))).toBe(512);
  });

  it('lets a long header pass the cell cap, as a header does in auto layout', () => {
    expect(widthOf('a', column('n'.repeat(100)))).toBeGreaterThan(660);
  });

  it('counts a wide character as two', () => {
    expect(widthOf('漢'.repeat(40))).toBe(widthOf('x'.repeat(80)));
  });

  it('reserves room for a bar and for a foreign key arrow', () => {
    const typed = column('c', 'DOUBLE', true);
    const rows = [{ c: 1.234567890123456 }];
    const plain = planColumns([typed], rows, new Set(), undefined).widths[0]!;
    expect(planColumns([typed], rows, new Set(['c']), undefined).widths[0]).toBe(plain + 56);
    expect(planColumns([typed], rows, new Set(), new Set(['c'])).widths[0]).toBeGreaterThan(plain);
  });

  it('leaves images and BLOBs at the minimum, since they draw as thumbnails', () => {
    expect(widthOf('A'.repeat(400), column('c', 'BLOB'))).toBe(200);
    expect(widthOf(`data:image/png;base64,${'A'.repeat(400)}`)).toBe(200);
  });

  it('samples across the rows, so a long value past the first screenfuls still counts', () => {
    const rows = Array.from({ length: 2000 }, (_, r) => ({ c: r === 1000 ? 'x'.repeat(40) : 'a' }));
    expect(planColumns([column('c')], rows, new Set(), undefined).widths[0]).toBe(285);
  });

  it('stops reading a column that reached the cap', () => {
    const toJSON = vi.fn(() => 'x'.repeat(5000));
    const rows = Array.from({ length: 50 }, () => ({ c: { toJSON } }));
    planColumns([column('c')], rows, new Set(), undefined);
    expect(toJSON).toHaveBeenCalledTimes(1);
  });

  it('accumulates offsets ending at the table width', () => {
    const plan = planColumns([column('a'), column('b', 'BIGINT', true)], [{ a: 'x', b: 1 }], new Set(), undefined);
    expect(plan.offsets).toEqual([0, 200, 330]);
  });
});

describe('fixedColumnWindow', () => {
  const offsets = Array.from({ length: 101 }, (_, c) => c * 100);

  it('covers the viewport plus overscan', () => {
    expect(fixedColumnWindow({ offsets, scrollLeft: 1000, viewportWidth: 500, overscan: 2 })).toEqual({ start: 8, end: 17 });
  });

  it('clamps at both ends', () => {
    expect(fixedColumnWindow({ offsets, scrollLeft: 0, viewportWidth: 500, overscan: 2 }).start).toBe(0);
    expect(fixedColumnWindow({ offsets, scrollLeft: 9500, viewportWidth: 500, overscan: 2 }).end).toBe(99);
    expect(fixedColumnWindow({ offsets, scrollLeft: 99_999, viewportWidth: 500, overscan: 0 })).toEqual({ start: 99, end: 99 });
  });

  it('treats elastic overscroll as the left edge', () => {
    expect(fixedColumnWindow({ offsets, scrollLeft: -50, viewportWidth: 500, overscan: 0 }).start).toBe(0);
  });

  it('assumes a screenful when the viewport is unmeasured', () => {
    expect(fixedColumnWindow({ offsets, scrollLeft: 0, viewportWidth: 0, overscan: 0 })).toEqual({ start: 0, end: 12 });
  });

  it('is empty without columns', () => {
    expect(fixedColumnWindow({ offsets: [0], scrollLeft: 0, viewportWidth: 500, overscan: 2 })).toEqual({ start: 0, end: -1 });
  });
});

describe('columnSlots', () => {
  const typed = Array.from({ length: 10 }, (_, index) => column(`c${index}`, 'VARCHAR', false, index));
  const shape = (start: number, end: number, pinned?: number) =>
    columnSlots(typed, start, end, pinned).map((slot) => ('gap' in slot ? `+${slot.gap}` : slot.index));
  const isGap = (slot: unknown): slot is ColumnGap => typeof slot === 'object' && slot !== null && 'gap' in slot;

  it('spaces the window on both sides, and only where columns are skipped', () => {
    expect(shape(3, 5)).toEqual(['+3', 3, 4, 5, '+4']);
    expect(shape(0, 2)).toEqual([0, 1, 2, '+7']);
    expect(shape(7, 9)).toEqual(['+7', 7, 8, 9]);
    expect(shape(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps a pinned column in its own place', () => {
    expect(shape(4, 5, 1)).toEqual(['+1', 1, '+2', 4, 5, '+4']);
    expect(shape(4, 5, 8)).toEqual(['+4', 4, 5, '+2', 8, '+1']);
    expect(shape(4, 5, 0)).toEqual([0, '+3', 4, 5, '+4']);
    expect(shape(4, 5, 3)).toEqual(['+3', 3, 4, 5, '+4']);
  });

  it('adds nothing for a pinned column inside the window', () => {
    expect(shape(3, 5, 4)).toEqual(shape(3, 5));
  });

  it('accounts for every column exactly once and gives gaps distinct keys', () => {
    for (const pinned of [-1, 0, 3, 6, 9]) {
      const slots = columnSlots(typed, 4, 5, pinned);
      expect(slots.reduce((sum, slot) => sum + (isGap(slot) ? slot.gap : 1), 0)).toBe(10);
      const keys = slots.filter(isGap).map((slot) => slot.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
