import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessWindowsSigningPrerequisites,
  main,
  parseReportSnapshot,
  renderHtmlReport,
  renderMarkdownReport,
  WINDOWS_CERTIFICATE_PASSWORD_SECRET,
  WINDOWS_CERTIFICATE_SECRET,
  WINDOWS_SIGNING_SUMMARY_LINES,
} from '../../scripts/windows-signing-prerequisites.mjs';

const GENERATED_AT = '2026-08-02T04:15:00.000Z';

function reportWith(names: string[]) {
  return assessWindowsSigningPrerequisites({
    repositorySecrets: names.map(name => ({ name })),
    generatedAt: GENERATED_AT,
  });
}

describe('Windows signing prerequisites', () => {
  it('reports a missing public-trust signing configuration without secret values', () => {
    const report = reportWith([]);

    expect(report).toMatchObject({
      automatedStatus: 'blocked',
      status: 'blocked',
      checks: {
        certificateSecret: {
          status: 'blocked',
          name: WINDOWS_CERTIFICATE_SECRET,
          present: false,
        },
        passwordSecret: {
          status: 'blocked',
          name: WINDOWS_CERTIFICATE_PASSWORD_SECRET,
          present: false,
        },
        secretPair: { status: 'blocked', complete: false, partial: false },
        runtimeVerification: { status: 'review-required' },
      },
    });
    expect(report.actions).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('secretValue');
  });

  it.each([
    [WINDOWS_CERTIFICATE_SECRET, WINDOWS_CERTIFICATE_PASSWORD_SECRET],
    [WINDOWS_CERTIFICATE_PASSWORD_SECRET, WINDOWS_CERTIFICATE_SECRET],
  ])('fails closed for an orphaned %s and names %s as missing', (present, missing) => {
    const report = reportWith([present]);

    expect(report.status).toBe('blocked');
    expect(report.checks.secretPair).toEqual({
      status: 'blocked',
      complete: false,
      partial: true,
    });
    expect(report.actions).toEqual([
      `Complete the Authenticode pair by adding ${missing}, or remove the orphaned secret before the next release.`,
    ]);
  });

  it('separates name-level readiness from draft runtime verification', () => {
    const report = reportWith([
      WINDOWS_CERTIFICATE_SECRET,
      WINDOWS_CERTIFICATE_PASSWORD_SECRET,
      'UNRELATED_SECRET',
    ]);

    expect(report.automatedStatus).toBe('ready');
    expect(report.status).toBe('review-required');
    expect(report.checks.secretPair).toEqual({
      status: 'ready',
      complete: true,
      partial: false,
    });
    expect(report.checks.runtimeVerification.requiredEvidence).toEqual([
      ...WINDOWS_SIGNING_SUMMARY_LINES,
    ]);
    expect(JSON.stringify(report)).not.toContain('UNRELATED_SECRET');
  });

  it('renders complete bilingual operational evidence', () => {
    const report = reportWith([]);
    const english = renderMarkdownReport(report, 'en');
    const spanish = renderMarkdownReport(report, 'es');
    const html = renderHtmlReport(report, 'es');

    expect(english).toContain('# Windows signing prerequisites');
    expect(english).toContain('| Authenticode pair | Blocked | not configured |');
    expect(spanish).toContain('# Prerrequisitos de firma para Windows');
    expect(spanish).toContain('| Par de Authenticode | Bloqueado | sin configurar |');
    expect(spanish).toContain('Obtén un certificado exportable');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<title>Prerrequisitos de firma para Windows de Lingua</title>');
    expect(html).toContain('los valores de secretos nunca se solicitan');
  });

  it('rejects extra fields and internally inconsistent saved evidence', () => {
    const report = reportWith([]);

    expect(parseReportSnapshot(JSON.stringify(report))).toEqual(report);
    expect(() =>
      parseReportSnapshot(JSON.stringify({ ...report, secretValue: 'must-not-survive' }))
    ).toThrow('not a Lingua Windows signing prerequisite schema v1 report');
    expect(() =>
      parseReportSnapshot(
        JSON.stringify({
          ...report,
          status: 'review-required',
        })
      )
    ).toThrow('inconsistent Lingua Windows signing prerequisite evidence');
  });

  it('re-renders a saved report without invoking gh', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-windows-signing-prereqs-'));
    const input = path.join(root, 'report.json');
    const output = path.join(root, 'report.html');
    const report = reportWith([]);
    try {
      await writeFile(input, JSON.stringify(report));
      await expect(
        main(['--input', input, '--format', 'html', '--locale', 'es', '--output', output])
      ).resolves.toBe(0);
      expect(await readFile(output, 'utf8')).toContain('Confianza antes de publicar');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
