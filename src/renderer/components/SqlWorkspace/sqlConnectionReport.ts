import type { SqlConnectionDraft } from '../../../shared/sqlConnections';
import type { SqlDbTestResult } from '../../../shared/sqlDb';

/** Replaces every occurrence of each secret-ish value with a placeholder. */
function scrub(text: string, values: Array<[string | undefined, string]>): string {
  let out = text;
  // Longest first, so a host inside another name (db in db-bastion) does not leave the rest behind.
  for (const [value, label] of [...values].sort((a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0))) {
    if (value && value.length >= 2) out = out.split(value).join(label);
  }
  return out;
}

/**
 * The plain-text diagnostics Copy puts on the clipboard: every step with its
 * timing and detail, with hosts, addresses, users, database and file paths
 * replaced, the SSH tunnel's included.
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
    [draft.ssh?.keyPath, '<file>'],
    [draft.ssh?.host, '<ssh host>'],
    [draft.ssh?.user, '<ssh user>'],
    ...(draft.ssh?.jumps ?? []).flatMap((hop): Array<[string, string]> => [
      [hop.host, '<jump host>'],
      [hop.user, '<ssh user>'],
    ]),
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
  // Server messages can name the client address, and a certificate can name another host.
  return scrub(lines.join('\n'), secrets)
    .replace(/\bCN [^\s·]+/g, 'CN <name>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<address>')
    .replace(/(?<![\w:])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi, (match) => (/[0-9a-f]/i.test(match) ? '<address>' : match));
}
