/**
 * RL-099 Slice 1 — `diff-text` adapter.
 *
 * Diffs the chained input against a baseline carried in
 * `options.baseline`. The pipeline model is linear (one input per
 * step), so the "compare against" string lives in the step's options
 * blob instead of a second input slot. Output is a unified text diff
 * (line-by-line `+ - =` markers) that composes cleanly with text
 * downstream adapters.
 *
 * Output cap mirrors the renderer panel (8 KiB pre-trim) so a
 * pathological diff against a 1 MiB baseline doesn't blow up the
 * renderer.
 */

import type { UtilityAdapter } from './types';

const DIFF_MAX_INPUT_CHARS = 8 * 1024;
/**
 * Hard cap on the LCS DP table size. The naive `(m+1)*(n+1)` matrix
 * is `O(m·n)` numbers × 8 bytes per Number — at the pathological end
 * of `DIFF_MAX_INPUT_CHARS` chars (~8 KiB) of `\n`-separated single
 * chars each side, m=n=8192 → 67M cells → ~536 MB on the renderer
 * heap. The defensive cap below ensures the diff returns a clean
 * error instead of OOM'ing the renderer when an adversarial baseline
 * comes in via persisted pipeline import. Realistic inputs (avg ~40
 * chars/line over 8 KiB) sit at m+n ≤ ~400 lines, ~160k cells, well
 * inside the cap.
 */
const DIFF_MAX_DP_CELLS = 1_000_000;

export interface DiffTextOptions {
  /** String to diff against; chained input is the "right" side. */
  baseline: string;
  /** Mode: 'unified' produces text markers; 'json' emits an array of {kind, text}. */
  mode: 'unified' | 'json';
}

function isMode(value: unknown): value is DiffTextOptions['mode'] {
  return value === 'unified' || value === 'json';
}

export interface DiffEntry {
  kind: 'add' | 'remove' | 'same';
  text: string;
}

export type DiffComputeResult =
  | { ok: true; entries: ReadonlyArray<DiffEntry> }
  | { ok: false; reason: 'too-many-lines'; detail: string };

/** Tiny LCS-based diff. Doesn't try to compete with diff-match-patch; clarity > speed. */
function computeLineDiff(left: string, right: string): DiffComputeResult {
  const leftLines = left.length === 0 ? [] : left.split('\n');
  const rightLines = right.length === 0 ? [] : right.split('\n');
  const m = leftLines.length;
  const n = rightLines.length;
  if ((m + 1) * (n + 1) > DIFF_MAX_DP_CELLS) {
    return {
      ok: false,
      reason: 'too-many-lines',
      detail: `Diff input has ${m}+${n} lines; LCS table would exceed the ${DIFF_MAX_DP_CELLS.toLocaleString()}-cell cap. Trim the baseline or input.`,
    };
  }
  // O(m·n) LCS — DP table size bounded above so worst-case memory
  // is ~8 MB on the renderer heap.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      const row = dp[i];
      const next = dp[i + 1];
      if (row === undefined || next === undefined) continue;
      if (leftLines[i] === rightLines[j]) {
        row[j] = (next[j + 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(next[j] ?? 0, row[j + 1] ?? 0);
      }
    }
  }
  const out: DiffEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (leftLines[i] === rightLines[j]) {
      out.push({ kind: 'same', text: leftLines[i] ?? '' });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ kind: 'remove', text: leftLines[i] ?? '' });
      i += 1;
    } else {
      out.push({ kind: 'add', text: rightLines[j] ?? '' });
      j += 1;
    }
  }
  while (i < m) out.push({ kind: 'remove', text: leftLines[i++] ?? '' });
  while (j < n) out.push({ kind: 'add', text: rightLines[j++] ?? '' });
  return { ok: true, entries: out };
}

function formatUnified(entries: ReadonlyArray<DiffEntry>): string {
  return entries
    .map((entry) => {
      const marker = entry.kind === 'add' ? '+' : entry.kind === 'remove' ? '-' : ' ';
      return `${marker} ${entry.text}`;
    })
    .join('\n');
}

export const diffTextAdapter: UtilityAdapter<DiffTextOptions> = {
  id: 'diff-text',
  titleKey: 'utilityPipeline.adapter.diffText.title',
  descriptionKey: 'utilityPipeline.adapter.diffText.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [
    {
      key: 'baseline',
      type: 'textarea',
      labelKey: 'utilityPipeline.adapter.diffText.options.baseline',
      placeholderKey: 'utilityPipeline.adapter.diffText.options.baselinePlaceholder',
      defaultValue: '',
    },
    {
      key: 'mode',
      type: 'select',
      labelKey: 'utilityPipeline.adapter.diffText.options.mode',
      options: [
        {
          value: 'unified',
          labelKey: 'utilityPipeline.adapter.diffText.options.mode.unified',
        },
        {
          value: 'json',
          labelKey: 'utilityPipeline.adapter.diffText.options.mode.json',
        },
      ],
      defaultValue: 'unified',
    },
  ],
  defaultOptions: () => ({ baseline: '', mode: 'unified' }),
  parseOptions: (raw): DiffTextOptions | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.baseline !== 'string') return null;
    if (!isMode(record.mode)) return null;
    return { baseline: record.baseline, mode: record.mode };
  },
  run: async (input, options) => {
    if (options.baseline.length === 0 && input.length === 0) {
      return { ok: true, value: '' };
    }
    const leftTrunc = options.baseline.slice(0, DIFF_MAX_INPUT_CHARS);
    const rightTrunc = input.slice(0, DIFF_MAX_INPUT_CHARS);
    const computed = computeLineDiff(leftTrunc, rightTrunc);
    if (!computed.ok) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: computed.detail,
      };
    }
    try {
      const value =
        options.mode === 'json'
          ? JSON.stringify(computed.entries, null, 2)
          : formatUnified(computed.entries);
      return { ok: true, value };
    } catch (err) {
      return {
        ok: false,
        reason: 'execution-error',
        detail: err instanceof Error ? err.message : 'diff format failed',
      };
    }
  },
};
