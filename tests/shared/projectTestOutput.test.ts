// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  appendProjectTestOutput,
  PROJECT_TEST_MAX_OUTPUT_BYTES,
  PROJECT_TEST_OUTPUT_TRUNCATION_MARKER as marker,
} from '../../src/shared/projectTestOutput';

describe('bounded observed project-test transcript', () => {
  it('preserves chunks verbatim without separators or inferred pipe order', () => {
    const first = appendProjectTestOutput(undefined, 'first\r\n');
    const second = appendProjectTestOutput(first, '警告');
    expect(appendProjectTestOutput(second, 'last')).toEqual({
      text: 'first\r\n警告last',
      truncated: false,
    });
  });
  it('does not interpret user-authored truncation text as control metadata', () => {
    const first = appendProjectTestOutput(undefined, marker);
    expect(appendProjectTestOutput(first, 'next').text).toBe(marker + 'next');
  });
  it('bounds the transcript, keeps Unicode whole and ignores chunks after truncation', () => {
    const limit = 2 * PROJECT_TEST_MAX_OUTPUT_BYTES;
    const prefix = 'a'.repeat(limit - marker.length - 1);
    const output = appendProjectTestOutput(undefined, prefix + '😀' + 'b'.repeat(marker.length));
    expect(output.text).toBe(prefix + marker);
    expect(output.text.length).toBeLessThanOrEqual(limit);
    expect(output.truncated).toBe(true);
    expect(appendProjectTestOutput(output, 'late')).toBe(output);
  });
});
