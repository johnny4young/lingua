import type { SqlConnectionDraft } from '../../../shared/sqlConnections';
import type { SqlDbTestResult } from '../../../shared/sqlDb';

/** Replaces every occurrence of each secret-ish value with a placeholder. */
function scrub(text: string, values: Array<[string | undefined, string]>): string {
  let out = text;
  for (const [value, label] of values) {
    if (value && value.length >= 2) out = out.split(value).join(label);
  }
  return out;
}

/**
 * The plain-text diagnostics Copy puts on the clipboard: every step with its
 * timing and detail, with host, address, user, database and file path replaced.
 */
export function buildTestReport(
  result: SqlDbTestResult,
  draft: SqlConnectionDraft,
  label: (stepId: string) => string,
  statusLabel: (status: string) => string
): string {
  const addresses = result.steps
    .filter((step) => step.id === 'resolve' && step.detail)
    .flatMap((step) => [step.detail!.split('→').pop()?.trim()]);
  const secrets: Array<[string | undefined, string]> = [
    [draft.host, '<host>'],
    ...addresses.map((address): [string | undefined, string] => [address, '<address>']),
    [draft.user, '<user>'],
    [draft.database, '<database>'],
    [draft.path, '<file>'],
  ];
  const lines = [
    `Lingua · ${draft.engine} · ${result.ok ? 'connected' : 'failed'} · ${result.totalMs} ms`,
    ...(result.serverVersion ? [result.serverVersion] : []),
    ...result.steps.map((step) =>
      [statusLabel(step.status), label(step.id), step.ms !== undefined ? `${step.ms} ms` : '', step.detail ?? '', step.fix ? `fix: ${step.fix}` : '']
        .filter(Boolean)
        .join(' · ')
    ),
  ];
  return scrub(lines.join('\n'), secrets);
}
