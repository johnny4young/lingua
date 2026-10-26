// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createGoTestCollector,
  parseCargoTestOutput,
  parseJestStyleReport,
  parsePytestJunit,
} from '../../src/main/projectTestReports';

const fixture = (name: string) => readFileSync(path.join(__dirname, '../__fixtures__/projectTests', name), 'utf8');
const brief = (cases: { file: string; path: string[]; status: string }[]) => cases.map((entry) => `${entry.status} ${entry.file} ${entry.path.join(' > ')}`);

describe('project test reports', () => {
  it('reads Vitest JSON as project-relative cases with the failing line', () => {
    const { cases, truncated } = parseJestStyleReport(fixture('vitest.json'), '/project')!;
    expect(truncated).toBe(false);
    expect(brief(cases)).toEqual([
      'passed src/tax.test.ts top level',
      'passed src/total.test.ts cartTotal > sums quantities',
      'failed src/total.test.ts cartTotal > rounds cents',
      'skipped src/total.test.ts cartTotal > applies tax rate',
      'passed src/total.test.ts cartTotal > nested > works (a|b)',
    ]);
    expect(cases[2]).toMatchObject({
      failureFile: 'src/total.test.ts',
      failureLine: 8,
      failureMessage: 'AssertionError: expected 1211 to be 1210.5 // Object.is equality',
    });
  });

  it('reads Jest JSON, pending as skipped', () => {
    const { cases } = parseJestStyleReport(fixture('jest.json'), '/project')!;
    expect(brief(cases)).toEqual([
      'passed src/total.test.js cartTotal > sums quantities',
      'failed src/total.test.js cartTotal > rounds cents',
      'skipped src/total.test.js cartTotal > applies tax rate',
    ]);
    expect(cases[1]!.failureLine).toBe(3);
    expect(cases[1]!.failureMessage).toContain('Expected: 1210.5');
  });

  it('drops files outside the project root and rejects a report that is not JSON', () => {
    const outside = JSON.stringify({ testResults: [{ name: '/elsewhere/a.test.ts', assertionResults: [{ title: 't', status: 'passed' }] }] });
    expect(parseJestStyleReport(outside, '/project')!.cases).toEqual([]);
    expect(parseJestStyleReport('not json', '/project')).toBeNull();
  });

  it('reads pytest JUnit with classes, parameters and the assertion line', () => {
    const { cases } = parsePytestJunit(fixture('pytest.xml'))!;
    expect(brief(cases)).toEqual([
      'passed tests/test_cart.py test_sums',
      'failed tests/test_cart.py test_rounds',
      'skipped tests/test_cart.py test_later',
      'passed tests/test_cart.py TestCheckout > test_flow',
      'passed tests/test_cart.py test_param[1]',
      'failed tests/test_cart.py test_param[2]',
    ]);
    expect(cases[1]).toMatchObject({ failureFile: 'tests/test_cart.py', failureLine: 7, failureMessage: 'assert 1211 == 1210.5' });
  });

  it('keeps an attribute value with a closing bracket inside its quotes', () => {
    const xml = '<testsuite><testcase classname="t" name="test_x[a&gt;b]" file="t.py" line="1" time="0.1"/></testsuite>';
    expect(parsePytestJunit(xml)!.cases[0]!.path).toEqual(['test_x[a>b]']);
  });

  it('streams go test -json into leaf cases and the plain go test text', () => {
    const collector = createGoTestCollector('example.com/shop');
    const raw = fixture('go.ndjson');
    let text = '';
    for (let at = 0; at < raw.length; at += 97) text += collector.push(raw.slice(at, at + 97));
    text += collector.flush();
    const { cases } = collector.finish();
    expect(brief(cases).sort()).toEqual([
      'failed internal/cart TestRounds',
      'failed internal/cart TestTable > two',
      'passed . TestRoot',
      'passed internal/cart TestSums',
      'passed internal/cart TestTable > one',
      'skipped internal/cart TestSkipped',
    ]);
    expect(cases.find((entry) => entry.path[0] === 'TestRounds')).toMatchObject({
      failureFile: 'internal/cart/total_test.go',
      failureLine: 9,
    });
    expect(text).toContain('--- FAIL: TestRounds');
    expect(text).not.toContain('"Action"');
  });

  it('reads cargo test text across unit, integration and doc tests', () => {
    const { cases } = parseCargoTestOutput(fixture('cargo.txt'));
    expect(brief(cases)).toEqual([
      'skipped src/lib.rs tests > later',
      'passed src/lib.rs tests > sums',
      'failed src/lib.rs tests > rounds',
      'passed tests/flow.rs checkout_works',
      'passed src/lib.rs add (line 3)',
    ]);
    expect(cases[2]).toMatchObject({ failureFile: 'src/lib.rs', failureLine: 14 });
    expect(cases[2]!.failureMessage).toContain('left: 4');
    expect(cases[4]!.runnable).toBe(false);
  });

  it('turns a Go package that does not build into one failed, non-runnable case', () => {
    const collector = createGoTestCollector('example.com/shop');
    collector.push(fixture('go-build-fail.ndjson'));
    collector.flush();
    const { cases } = collector.finish();
    expect(brief(cases)).toEqual(['passed . TestRoot', 'failed internal/broken ']);
    expect(cases[1]).toMatchObject({
      runnable: false,
      failureFile: 'internal/broken/b_test.go',
      failureLine: 5,
    });
    expect(cases[1]!.failureMessage).toContain("expected operand, found ';'");
  });

  it('reads no cases from a cargo run that stops at a compile error', () => {
    expect(parseCargoTestOutput(fixture('cargo-build-fail.txt')).cases).toEqual([]);
  });
});
