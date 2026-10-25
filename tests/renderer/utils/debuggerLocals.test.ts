import { describe, expect, it } from 'vitest';
import { localsChanges, orderedLocals } from '../../../src/renderer/utils/debuggerLocals';

describe('debugger locals diff', () => {
  it('marks nothing on the first pause', () => {
    expect(localsChanges(null, { a: '1' }).size).toBe(0);
  });

  it('marks new and changed bindings with the value they had', () => {
    const changes = localsChanges({ arr: '[3]', pivot: '1' }, { arr: '[3]', pivot: '10', left: '[]' });
    expect(Object.fromEntries(changes)).toEqual({ pivot: { kind: 'changed', before: '1' }, left: { kind: 'new' } });
  });

  it('keeps the previous order and appends new names', () => {
    expect(orderedLocals({ b: '1', a: '1' }, { a: '2', c: '3', b: '1' })).toEqual([
      ['b', '1'],
      ['a', '2'],
      ['c', '3'],
    ]);
    expect(orderedLocals(undefined, { a: '1', b: '2' })).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });
});
