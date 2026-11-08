import type { RunCapsuleStatus, RunCapsuleV1 } from '../../shared/runCapsule';

/** A short result line for SQL and HTTP runs, rendered with the reader's locale. */
export type RunCompareSummary =
  | { kind: 'rows'; count: number; columns: string[] }
  | { kind: 'http'; method: string; status: number; statusText: string; bytes: number };

interface RunCompareValue {
  line: number;
  value: string;
}

/**
 * What the Compare tab runCompare needs from one run, cut from its capsule so it
 * outlives the capsule cap. In memory only, like the rest of the history.
 */
export interface RunCompareRecord {
  name: string;
  language: string;
  runtime: string;
  code: string;
  stdout: string;
  stderr: string;
  /** Code, stdout or stderr was cut at its cap. */
  truncated: boolean;
  values: RunCompareValue[];
  exit: RunCapsuleStatus;
  errorMessage?: string;
  summary?: RunCompareSummary;
}

export const RUN_COMPARE_CODE_MAX_CHARS = 256 * 1024;
export const RUN_COMPARE_STREAM_MAX_CHARS = 64 * 1024;
export const RUN_COMPARE_MAX_VALUES = 200;
export const RUN_COMPARE_VALUE_MAX_CHARS = 200;

function clip(text: string | undefined, max: number): { text: string; cut: boolean } {
  const value = text ?? '';
  return value.length > max ? { text: value.slice(0, max), cut: true } : { text: value, cut: false };
}

function readValues(lineResults: unknown[] | undefined): RunCompareValue[] {
  const values: RunCompareValue[] = [];
  for (const item of lineResults ?? []) {
    if (values.length >= RUN_COMPARE_MAX_VALUES) break;
    if (!item || typeof item !== 'object') continue;
    const { line, value } = item as { line?: unknown; value?: unknown };
    if (typeof line !== 'number' || !Number.isInteger(line) || typeof value !== 'string') continue;
    values.push({ line, value: value.slice(0, RUN_COMPARE_VALUE_MAX_CHARS) });
  }
  return values;
}

export function buildRunCompareRecord(capsule: RunCapsuleV1, summary?: RunCompareSummary): RunCompareRecord {
  const code = clip(capsule.source.content, RUN_COMPARE_CODE_MAX_CHARS);
  const stdout = clip(capsule.result.stdout, RUN_COMPARE_STREAM_MAX_CHARS);
  const stderr = clip(capsule.result.stderr, RUN_COMPARE_STREAM_MAX_CHARS);
  return {
    name: capsule.tab.name,
    language: capsule.tab.language,
    runtime: capsule.tab.runtimeMode,
    code: code.text,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: code.cut || stdout.cut || stderr.cut,
    values: readValues(capsule.result.lineResults),
    exit: capsule.result.status,
    ...(capsule.result.errorMessage ? { errorMessage: capsule.result.errorMessage.slice(0, RUN_COMPARE_VALUE_MAX_CHARS) } : {}),
    ...(summary ? { summary } : {}),
  };
}
