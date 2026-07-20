import { describe, expect, it } from 'vitest';
import {
  appendScopeCapture,
  collectTopLevelScopeNames,
} from '../../src/renderer/utils/scopeCapture';

describe('implementation — JS scope-capture transform', () => {
  it('collects top-level lexical, function, class, and destructured bindings', () => {
    expect(
      collectTopLevelScopeNames(`
const answer = 42;
let label = 'ok';
var count = 1;
function helper() {}
class Box {}
const { nested, alias: renamed } = source;
const [first, , ...rest] = list;
if (true) {
  const blockOnly = 1;
}
`)
    ).toEqual([
      'Box',
      'answer',
      'count',
      'first',
      'helper',
      'label',
      'nested',
      'renamed',
      'rest',
    ]);
  });

  it('returns an empty list on syntax it cannot parse', () => {
    expect(collectTopLevelScopeNames('const =')).toEqual([]);
  });

  it('appends a same-scope capture call without changing empty-name code', () => {
    expect(appendScopeCapture('console.log(1);', [])).toBe('console.log(1);');
    expect(appendScopeCapture('const answer = 42;', ['answer'])).toContain(
      '"answer": () => answer'
    );
  });
});
