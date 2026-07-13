import { describe, expect, it } from 'vitest';
import {
  bucketAutoLogCount,
  isSameAutoRunInput,
  resolveAutoLogEnabled,
  type AutoRunInput,
} from '@/hooks/autoRunModel';

const BASE_INPUT: AutoRunInput = {
  code: 'const value = 1;',
  language: 'javascript',
  runtimeMode: 'worker',
  workflowMode: 'scratchpad',
  autoLogEnabled: false,
  stdinBuffer: undefined,
};

describe('autoRunModel', () => {
  it('resolves JS and TS auto-log from tab overrides before defaults', () => {
    const defaults = { javascript: true, typescript: false };

    expect(
      resolveAutoLogEnabled('javascript', 'scratchpad', undefined, defaults)
    ).toBe(true);
    expect(
      resolveAutoLogEnabled('javascript', 'scratchpad', false, defaults)
    ).toBe(false);
    expect(
      resolveAutoLogEnabled('typescript', 'scratchpad', true, defaults)
    ).toBe(true);
  });

  it('keeps auto-log off outside JS-family Scratchpad workflows', () => {
    expect(resolveAutoLogEnabled('python', 'scratchpad', true, {})).toBe(false);
    expect(resolveAutoLogEnabled('javascript', 'run', true, {})).toBe(false);
    expect(resolveAutoLogEnabled('typescript', 'debug', true, {})).toBe(false);
  });

  it('deduplicates only identical effective execution inputs', () => {
    expect(isSameAutoRunInput(BASE_INPUT, { ...BASE_INPUT })).toBe(true);
    expect(
      isSameAutoRunInput(BASE_INPUT, {
        ...BASE_INPUT,
        runtimeMode: 'browser-preview',
      })
    ).toBe(false);
    expect(
      isSameAutoRunInput(BASE_INPUT, {
        ...BASE_INPUT,
        stdinBuffer: 'first line',
      })
    ).toBe(false);
    expect(isSameAutoRunInput(null, BASE_INPUT)).toBe(false);
  });

  it('buckets emission counts into the telemetry allowlist', () => {
    expect(bucketAutoLogCount(0)).toBe('1');
    expect(bucketAutoLogCount(1)).toBe('1');
    expect(bucketAutoLogCount(2)).toBe('2-5');
    expect(bucketAutoLogCount(6)).toBe('6-20');
    expect(bucketAutoLogCount(21)).toBe('20-plus');
  });
});
