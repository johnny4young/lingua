import { describe, expect, it } from 'vitest';
import { editDeadline, expectOneRow } from '../../../src/main/sqlHost/driver';
import { ROW_EDIT_BUDGET_MS } from '../../../src/shared/sqlRowEdits';

describe('edit transaction guards', () => {
  it('stops a transaction that runs past its budget, which main outlasts', () => {
    let now = 1_000;
    const inTime = editDeadline(() => now);
    now += ROW_EDIT_BUDGET_MS;
    expect(inTime).not.toThrow();
    now += 1;
    expect(inTime).toThrow('took too long, so nothing was saved');
  });

  it('accepts exactly one touched row per statement', () => {
    expect(() => expectOneRow(0, 1)).not.toThrow();
    expect(() => expectOneRow(1, 0)).toThrow('Change 2 would touch 0 rows');
    expect(() => expectOneRow(2, null)).toThrow('Change 3 would touch 0 rows');
  });
});
