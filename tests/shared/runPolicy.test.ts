import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_POLICY_BY_GROUP,
  runPolicyDelayMs,
  runPolicyGroupFor,
  sanitizeRunPolicyByGroup,
} from '../../src/shared/runPolicy';

describe('run policy', () => {
  it('groups the Scratchpad languages and leaves SQL and HTTP out', () => {
    expect(['javascript', 'typescript', 'python', 'ruby', 'go', 'rust'].map(runPolicyGroupFor)).toEqual([
      'jsTs', 'jsTs', 'pythonRuby', 'pythonRuby', 'goRust', 'goRust',
    ]);
    expect(runPolicyGroupFor('sql')).toBeUndefined();
    expect(runPolicyGroupFor('http')).toBeUndefined();
    expect(runPolicyGroupFor('constructor')).toBeUndefined();
  });

  it('fails closed to Manual for a value the sanitizer never saw', () => {
    expect(runPolicyDelayMs('go', { ...DEFAULT_RUN_POLICY_BY_GROUP, goRust: 'sometimes' as never })).toBeNull();
  });

  it('turns the board defaults into debounces, Manual into none', () => {
    expect(DEFAULT_RUN_POLICY_BY_GROUP).toEqual({ jsTs: 'keystroke', pythonRuby: 'pause', goRust: 'manual' });
    expect(runPolicyDelayMs('typescript', DEFAULT_RUN_POLICY_BY_GROUP)).toBe(500);
    expect(runPolicyDelayMs('python', DEFAULT_RUN_POLICY_BY_GROUP)).toBe(1_000);
    expect(runPolicyDelayMs('rust', DEFAULT_RUN_POLICY_BY_GROUP)).toBeNull();
    expect(runPolicyDelayMs('lua', DEFAULT_RUN_POLICY_BY_GROUP)).toBeUndefined();
  });

  it('keeps known choices and restores the defaults for anything else', () => {
    expect(sanitizeRunPolicyByGroup({ jsTs: 'manual', goRust: 'sometimes', extra: 'pause' })).toEqual({
      jsTs: 'manual', pythonRuby: 'pause', goRust: 'manual',
    });
    expect(sanitizeRunPolicyByGroup(null)).toEqual(DEFAULT_RUN_POLICY_BY_GROUP);
    expect(sanitizeRunPolicyByGroup(['manual'])).toEqual(DEFAULT_RUN_POLICY_BY_GROUP);
  });
});
