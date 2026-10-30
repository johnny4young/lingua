import { describe, expect, it } from 'vitest';
import {
  MAX_REPRO_DENIALS,
  parseReproReceipt,
  summarizeReproReceipt,
  type ReproLaunchedReceiptV1,
  type ReproRefusedReceiptV1,
  type ReproVerdict,
} from '../../src/shared/reproReceipt';
import { REPRO_CONTROLS, type ReproControlStatus } from '../../src/shared/reproPolicy';
import { tamperJson } from './jsonTamper';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

const MANDATORY = new Set(REPRO_CONTROLS.slice(0, 6));

/** Mandatory controls enforced; optional ones as the macOS spike measured them. */
const SEATBELT_LIKE_CONTROLS: ReproControlStatus[] = REPRO_CONTROLS.map(control => ({
  control,
  support: MANDATORY.has(control)
    ? 'enforced'
    : control === 'denial-evidence'
      ? 'unsupported'
      : 'sampled',
  required: MANDATORY.has(control),
}));

const HOST = {
  lingua: '1.6.0',
  os: 'darwin 27.0.1',
  arch: 'arm64',
  runtime: 'node 24.21.0',
  backend: { id: 'macos-seatbelt', version: '1' },
};

function launched(overrides: Partial<ReproLaunchedReceiptV1> = {}): ReproLaunchedReceiptV1 {
  return {
    kind: 'lingua-repro-receipt',
    version: 1,
    createdAt: '2026-10-29T12:00:01.000Z',
    contentDigest: DIGEST_A,
    approvedPolicyDigest: DIGEST_B,
    host: HOST,
    launch: 'launched',
    effectivePolicyDigest: DIGEST_C,
    controls: SEATBELT_LIKE_CONTROLS,
    execution: {
      status: 'success',
      exitCode: 0,
      signal: null,
      startedAt: '2026-10-29T12:00:00.000Z',
      endedAt: '2026-10-29T12:00:00.250Z',
      outputTruncated: false,
    },
    comparison: 'pass',
    evidence: { coverage: 'unavailable', denials: [] },
    ...overrides,
  };
}

function refused(overrides: Partial<ReproRefusedReceiptV1> = {}): ReproRefusedReceiptV1 {
  return {
    kind: 'lingua-repro-receipt',
    version: 1,
    createdAt: '2026-10-29T12:00:00.000Z',
    contentDigest: DIGEST_A,
    approvedPolicyDigest: DIGEST_B,
    host: { ...HOST, runtime: null },
    launch: 'refused',
    refusalReason: 'unenforceable',
    missingControls: ['denial-evidence'],
    ...overrides,
  };
}

function withControl(replacement: ReproControlStatus): ReproControlStatus[] {
  return SEATBELT_LIKE_CONTROLS.map(status =>
    status.control === replacement.control ? replacement : status
  );
}

describe('parseReproReceipt', () => {
  it.each([
    ['a launched receipt', launched()],
    ['a refused receipt', refused()],
    [
      'denials inside staging areas and outside without a path',
      launched({
        evidence: {
          coverage: 'complete',
          denials: [
            { operation: 'file-write', area: 'inputs', path: 'lib/sum.mjs' },
            { operation: 'file-read', area: 'outside' },
            { operation: 'network', area: 'outside' },
          ],
        },
      }),
    ],
  ])('round-trips %s', (_name, receipt) => {
    expect(parseReproReceipt(JSON.stringify(receipt))).toEqual({ ok: true, value: receipt });
  });

  it.each<[string, () => string, string]>([
    [
      'an unknown top-level key',
      () => tamperJson(launched(), raw => Object.assign(raw, { stdout: 'ok' })),
      'stdout',
    ],
    [
      'an absolute denial path',
      () =>
        tamperJson(launched(), raw => {
          raw.evidence.denials = [
            { operation: 'file-read', area: 'inputs', path: '/Users/demo/.ssh/id_rsa' },
          ];
        }),
      'evidence',
    ],
    [
      'a path on a denial outside staging',
      () =>
        tamperJson(launched(), raw => {
          raw.evidence.denials = [{ operation: 'file-read', area: 'outside', path: 'etc/hosts' }];
        }),
      'evidence',
    ],
    [
      'denials under unavailable evidence',
      () =>
        tamperJson(launched(), raw => {
          raw.evidence.denials = [{ operation: 'network', area: 'outside' }];
        }),
      'evidence',
    ],
    [
      'more denials than the cap',
      () =>
        tamperJson(launched(), raw => {
          raw.evidence = {
            coverage: 'partial',
            denials: Array.from({ length: MAX_REPRO_DENIALS + 1 }, () => ({
              operation: 'network' as const,
              area: 'outside' as const,
            })),
          };
        }),
      'evidence',
    ],
    [
      'a host field carrying a path',
      () =>
        tamperJson(launched(), raw => {
          raw.host.os = '/System/Library/CoreServices';
        }),
      'host',
    ],
    [
      'a launched receipt without a backend',
      () =>
        tamperJson(launched(), raw => {
          raw.host.backend = null;
        }),
      'host',
    ],
    [
      'a control list missing one control',
      () => tamperJson(launched(), raw => raw.controls.pop()),
      'controls',
    ],
    [
      'controls out of order',
      () => tamperJson(launched(), raw => raw.controls.reverse()),
      'controls',
    ],
    [
      'an end time before the start time',
      () =>
        tamperJson(launched(), raw => {
          raw.execution.endedAt = '2026-10-29T11:59:59.000Z';
        }),
      'execution',
    ],
    [
      'a malformed digest',
      () =>
        tamperJson(launched(), raw => {
          raw.effectivePolicyDigest = 'abc';
        }),
      'effectivePolicyDigest',
    ],
    [
      'an unenforceable refusal without missing controls',
      () =>
        tamperJson(refused(), raw => {
          raw.missingControls = [];
        }),
      'missingControls',
    ],
    [
      'a backend-unavailable refusal that names missing controls',
      () =>
        tamperJson(refused(), raw => {
          raw.refusalReason = 'backend-unavailable';
        }),
      'missingControls',
    ],
    [
      'a refused receipt carrying execution',
      () => tamperJson(refused(), raw => Object.assign(raw, { execution: launched().execution })),
      'execution',
    ],
  ])('rejects %s', (_name, tampered, detail) => {
    expect(parseReproReceipt(tampered())).toEqual({ ok: false, reason: 'invalid-shape', detail });
  });

  it('rejects a newer receipt version', () => {
    expect(
      parseReproReceipt(tamperJson(launched(), raw => Object.assign(raw, { version: 2 })))
    ).toEqual({
      ok: false,
      reason: 'unsupported-version',
      detail: 'version=2',
    });
  });
});

describe('summarizeReproReceipt', () => {
  it.each<[string, ReproLaunchedReceiptV1 | ReproRefusedReceiptV1, ReproVerdict]>([
    [
      'a refused launch runs nothing',
      refused(),
      {
        overall: 'refused',
        output: 'not-run',
        enforcement: 'not-run',
        compliance: 'not-run',
        evidence: 'not-run',
      },
    ],
    [
      'a match with complete evidence and no denials is a clean pass',
      launched({ evidence: { coverage: 'complete', denials: [] } }),
      {
        overall: 'pass',
        output: 'pass',
        enforcement: 'enforced',
        compliance: 'clean',
        evidence: 'complete',
      },
    ],
    [
      'a match without denial evidence passes but is not observed as clean',
      launched(),
      {
        overall: 'pass',
        output: 'pass',
        enforcement: 'enforced',
        compliance: 'not-observed',
        evidence: 'unavailable',
      },
    ],
    [
      'a caught denial fails even when the output matches',
      launched({
        evidence: { coverage: 'complete', denials: [{ operation: 'file-read', area: 'outside' }] },
      }),
      {
        overall: 'fail',
        output: 'pass',
        enforcement: 'enforced',
        compliance: 'violated',
        evidence: 'complete',
      },
    ],
    [
      'a denial in partial evidence still fails',
      launched({
        evidence: { coverage: 'partial', denials: [{ operation: 'network', area: 'outside' }] },
      }),
      {
        overall: 'fail',
        output: 'pass',
        enforcement: 'enforced',
        compliance: 'violated',
        evidence: 'partial',
      },
    ],
    [
      'an output mismatch fails',
      launched({ comparison: 'fail' }),
      {
        overall: 'fail',
        output: 'fail',
        enforcement: 'enforced',
        compliance: 'not-observed',
        evidence: 'unavailable',
      },
    ],
    [
      'an inconclusive comparison is incomplete',
      launched({ comparison: 'inconclusive' }),
      {
        overall: 'incomplete',
        output: 'inconclusive',
        enforcement: 'enforced',
        compliance: 'not-observed',
        evidence: 'unavailable',
      },
    ],
    [
      'required evidence that is only partial is incomplete',
      launched({
        controls: withControl({ control: 'denial-evidence', support: 'enforced', required: true }),
        evidence: { coverage: 'partial', denials: [] },
      }),
      {
        overall: 'incomplete',
        output: 'pass',
        enforcement: 'enforced',
        compliance: 'not-observed',
        evidence: 'partial',
      },
    ],
    [
      'a failed evidence collector is incomplete even when evidence was optional',
      launched({ evidence: { coverage: 'collection-failed', denials: [] } }),
      {
        overall: 'incomplete',
        output: 'pass',
        enforcement: 'enforced',
        compliance: 'not-observed',
        evidence: 'collection-failed',
      },
    ],
    [
      'a required control that was only sampled is incomplete',
      launched({
        controls: withControl({ control: 'memory-limit', support: 'sampled', required: true }),
      }),
      {
        overall: 'incomplete',
        output: 'pass',
        enforcement: 'gaps',
        compliance: 'not-observed',
        evidence: 'unavailable',
      },
    ],
  ])('%s', (_name, receipt, expected) => {
    expect(summarizeReproReceipt(receipt)).toEqual(expected);
  });
});
