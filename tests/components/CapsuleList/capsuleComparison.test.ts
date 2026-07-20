/**
 * implementation — pure capsule comparison model.
 *
 * Covers: identical capsules collapse to `contentIdentical`; differing
 * code / input / output produce the right add/remove counts; cross-language
 * pairs report `sameLanguage: false` but still diff the code; missing
 * stdin on one or both sides; the `MAX_DIFF_LINES` line cap surfacing
 * `omittedLines`; the `DIFF_MAX_INPUT_CHARS` char clamp flag; and the
 * environment fields (platform / runner / git) surfaced on each side.
 */

import { describe, expect, it } from 'vitest';
import {
  compareRunCapsules,
  MAX_DIFF_LINES,
} from '../../../src/renderer/components/CapsuleList/capsuleComparison';
import { DIFF_MAX_INPUT_CHARS } from '../../../src/renderer/utils/diff';
import { summarizeDiff } from '../../../src/renderer/utils/diff';
import type { RunCapsuleV1 } from '../../../src/shared/runCapsule';

function capsule(overrides: {
  id?: string;
  language?: string;
  runtimeMode?: string;
  workflowMode?: string;
  status?: RunCapsuleV1['result']['status'];
  durationMs?: number;
  content?: string;
  stdin?: string;
  stdout?: string;
  stderr?: string;
  platform?: 'web' | 'desktop';
  runner?: string;
  git?: { branch?: string; commit?: string };
}): RunCapsuleV1 {
  return {
    version: 1,
    capsuleId: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-05-21T13:00:00.000Z',
    appVersion: '0.0.0-test',
    tab: {
      name: 'scratchpad',
      language: overrides.language ?? 'javascript',
      runtimeMode: overrides.runtimeMode ?? 'worker',
      workflowMode: overrides.workflowMode ?? 'scratchpad',
    },
    source: {
      content: overrides.content ?? '',
      contentHash: 'hash',
    },
    input: overrides.stdin !== undefined ? { stdin: overrides.stdin } : {},
    result: {
      status: overrides.status ?? 'success',
      durationMs: overrides.durationMs ?? 5,
      ...(overrides.stdout !== undefined ? { stdout: overrides.stdout } : {}),
      ...(overrides.stderr !== undefined ? { stderr: overrides.stderr } : {}),
    },
    environment: {
      platform: overrides.platform ?? 'web',
      runner: overrides.runner ?? 'javascript',
      ...(overrides.git ? { git: overrides.git } : {}),
    },
    privacy: { redactionVersion: '2026-05-21', omittedFields: [] },
  };
}

describe('compareRunCapsules', () => {
  it('reports contentIdentical with empty diffs for two identical capsules', () => {
    const a = capsule({ content: 'console.log(1)', stdin: 'x', stdout: 'out' });
    const b = capsule({ content: 'console.log(1)', stdin: 'x', stdout: 'out' });

    const model = compareRunCapsules(a, b);

    expect(model.contentIdentical).toBe(true);
    expect(summarizeDiff(model.codeDiff.diff)).toMatchObject({ add: 0, remove: 0 });
    expect(summarizeDiff(model.inputDiff.diff)).toMatchObject({ add: 0, remove: 0 });
    expect(summarizeDiff(model.outputDiff.diff)).toMatchObject({ add: 0, remove: 0 });
  });

  it('computes add/remove for differing code, input, and output', () => {
    const older = capsule({
      content: 'a\nb\nc',
      stdin: 'one',
      stdout: 'hello',
    });
    const newer = capsule({
      content: 'a\nB\nc',
      stdin: 'two',
      stdout: 'world',
    });

    const model = compareRunCapsules(older, newer);

    expect(model.contentIdentical).toBe(false);
    // Code: one line changed → at least one add + one remove.
    const code = summarizeDiff(model.codeDiff.diff);
    expect(code.add).toBeGreaterThan(0);
    expect(code.remove).toBeGreaterThan(0);
    // Input: single line replaced.
    const input = summarizeDiff(model.inputDiff.diff);
    expect(input.add).toBeGreaterThan(0);
    expect(input.remove).toBeGreaterThan(0);
    // Output: single line replaced.
    const output = summarizeDiff(model.outputDiff.diff);
    expect(output.add).toBeGreaterThan(0);
    expect(output.remove).toBeGreaterThan(0);
  });

  it('combines stdout + stderr into the output diff', () => {
    // Older has only stdout; newer adds a stderr line. The combined
    // output text differs, so the output diff is non-empty even though
    // stdout is byte-identical.
    const older = capsule({ stdout: 'same line' });
    const newer = capsule({ stdout: 'same line', stderr: 'boom' });

    const model = compareRunCapsules(older, newer);

    expect(model.outputDiff.olderText).toBe('same line');
    expect(model.outputDiff.newerText).toBe('same line\nboom');
    expect(summarizeDiff(model.outputDiff.diff).add).toBeGreaterThan(0);
    expect(model.contentIdentical).toBe(false);
  });

  it('reports sameLanguage:false across languages but still diffs the code', () => {
    const older = capsule({ language: 'python', content: 'print(1)' });
    const newer = capsule({ language: 'javascript', content: 'console.log(1)' });

    const model = compareRunCapsules(older, newer);

    expect(model.sameLanguage).toBe(false);
    expect(model.older.language).toBe('python');
    expect(model.newer.language).toBe('javascript');
    expect(model.codeDiff.diff.length).toBeGreaterThan(0);
  });

  it('empty-states the input section when neither side has stdin', () => {
    const a = capsule({ content: 'x' });
    const b = capsule({ content: 'y' });

    const model = compareRunCapsules(a, b);

    expect(model.inputDiff.empty).toBe(true);
    expect(model.inputDiff.olderText).toBe('');
    expect(model.inputDiff.newerText).toBe('');
  });

  it('treats a one-sided stdin as a non-empty input section with adds', () => {
    const older = capsule({ content: 'x' }); // no stdin
    const newer = capsule({ content: 'x', stdin: 'fresh input' });

    const model = compareRunCapsules(older, newer);

    expect(model.inputDiff.empty).toBe(false);
    expect(summarizeDiff(model.inputDiff.diff).add).toBeGreaterThan(0);
    // Code identical, output identical, but input differs → not identical.
    expect(model.contentIdentical).toBe(false);
  });

  it('caps rendered diff lines at MAX_DIFF_LINES and reports omittedLines', () => {
    // Build a code diff that produces more than MAX_DIFF_LINES segments:
    // older is N unique lines, newer is N different unique lines → ~2N
    // segments (N removes + N adds), well over the cap.
    const lineCount = MAX_DIFF_LINES + 50;
    const olderContent = Array.from({ length: lineCount }, (_, i) => `old-${i}`).join('\n');
    const newerContent = Array.from({ length: lineCount }, (_, i) => `new-${i}`).join('\n');
    const older = capsule({ content: olderContent });
    const newer = capsule({ content: newerContent });

    const model = compareRunCapsules(older, newer);

    expect(model.codeDiff.diff.length).toBe(MAX_DIFF_LINES);
    expect(model.codeDiff.omittedLines).toBeGreaterThan(0);
    // contentIdentical re-diffs the full text, so it stays correct despite
    // the cap.
    expect(model.contentIdentical).toBe(false);
  });

  it('sets the clamp flag when a side exceeds DIFF_MAX_INPUT_CHARS', () => {
    const huge = 'a'.repeat(DIFF_MAX_INPUT_CHARS + 1);
    const older = capsule({ content: huge });
    const newer = capsule({ content: `${huge}b` });

    const model = compareRunCapsules(older, newer);

    expect(model.codeDiff.clamped).toBe(true);
    // Sections under the limit stay unclamped.
    expect(model.inputDiff.clamped).toBe(false);
    expect(model.outputDiff.clamped).toBe(false);
  });

  it('does not report identical when content matches within the clamp but differs past it', () => {
    // `diffLines` clamps both sides to DIFF_MAX_INPUT_CHARS before diffing, so
    // the line diff sees only the (identical) first 40k chars and reports zero
    // deltas. A naive `contentIdentical` would collapse to "identical" and hide
    // the real difference (stdout/stderr cap at 1 MiB, so this is reachable).
    // The string-equality short-circuit must catch it.
    const prefix = 'a'.repeat(DIFF_MAX_INPUT_CHARS);
    const older = capsule({ content: `${prefix}OLDER-TAIL` });
    const newer = capsule({ content: `${prefix}NEWER-TAIL` });

    const model = compareRunCapsules(older, newer);

    expect(model.codeDiff.clamped).toBe(true);
    // The clamped differ genuinely sees identical text → zero deltas...
    expect(summarizeDiff(model.codeDiff.diff)).toMatchObject({ add: 0, remove: 0 });
    // ...but the capsules are NOT identical (they differ past the 40k clamp).
    expect(model.contentIdentical).toBe(false);
  });

  it('reports identical for byte-identical capsules even when clamped past 40k', () => {
    const huge = 'a'.repeat(DIFF_MAX_INPUT_CHARS + 100);
    const model = compareRunCapsules(capsule({ content: huge }), capsule({ content: huge }));

    expect(model.codeDiff.clamped).toBe(true);
    // Exact string equality sees the whole string regardless of the clamp.
    expect(model.contentIdentical).toBe(true);
  });

  it('surfaces platform / runner / git deltas on each side', () => {
    const older = capsule({
      platform: 'web',
      runner: 'javascript',
      git: { branch: 'main', commit: 'abc123' },
    });
    const newer = capsule({
      platform: 'desktop',
      runner: 'node-22.4.0',
      git: { branch: 'feature', commit: 'def456' },
    });

    const model = compareRunCapsules(older, newer);

    expect(model.older.platform).toBe('web');
    expect(model.newer.platform).toBe('desktop');
    expect(model.older.runner).toBe('javascript');
    expect(model.newer.runner).toBe('node-22.4.0');
    expect(model.older.gitBranch).toBe('main');
    expect(model.newer.gitBranch).toBe('feature');
    expect(model.older.gitCommit).toBe('abc123');
    expect(model.newer.gitCommit).toBe('def456');
  });

  it('leaves git fields undefined when the environment carries no git posture', () => {
    const a = capsule({ content: 'x' });
    const b = capsule({ content: 'y' });

    const model = compareRunCapsules(a, b);

    expect(model.older.gitBranch).toBeUndefined();
    expect(model.older.gitCommit).toBeUndefined();
    expect(model.newer.gitBranch).toBeUndefined();
  });

  it('carries the run status + duration on each side', () => {
    const older = capsule({ status: 'success', durationMs: 10 });
    const newer = capsule({ status: 'error', durationMs: 25 });

    const model = compareRunCapsules(older, newer);

    expect(model.older.status).toBe('success');
    expect(model.newer.status).toBe('error');
    expect(model.older.durationMs).toBe(10);
    expect(model.newer.durationMs).toBe(25);
  });
});
