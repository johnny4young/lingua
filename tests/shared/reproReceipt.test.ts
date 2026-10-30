import { describe, expect, it } from 'vitest';
import {
  MAX_REPRO_DENIALS,
  checkReproReceipt,
  parseReproReceipt,
  summarizeReproReceipt,
  type ReproLaunchedReceiptV1,
  type ReproRefusedReceiptV1,
  type ReproVerdict,
} from '../../src/shared/reproReceipt';
import {
  DEFAULT_REPRO_REQUEST,
  REPRO_CONTROLS,
  type ReproControlStatus,
  type ReproPolicyV1,
} from '../../src/shared/reproPolicy';
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
      'a successful run with a non-zero exit code',
      () =>
        tamperJson(launched(), raw => {
          raw.execution.exitCode = 1;
        }),
      'execution',
    ],
    [
      'a successful run ended by a signal',
      () =>
        tamperJson(launched(), raw => {
          raw.execution.signal = 'SIGKILL';
        }),
      'execution',
    ],
    [
      'an unenforceable refusal without a probed backend',
      () =>
        tamperJson(refused(), raw => {
          raw.host.backend = null;
        }),
      'host',
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

describe('checkReproReceipt', () => {
  const approval = { contentDigest: DIGEST_A, policyDigest: DIGEST_B };

  it.each<[string, ReproLaunchedReceiptV1 | ReproRefusedReceiptV1, string]>([
    ['a receipt bound to the approval', launched(), 'consistent'],
    ['a refusal bound to the approval', refused(), 'consistent'],
    ['a receipt for other inputs', launched({ contentDigest: DIGEST_C }), 'content-mismatch'],
    [
      'a receipt for another policy',
      launched({ approvedPolicyDigest: DIGEST_C }),
      'policy-mismatch',
    ],
  ])('reports %s as %s', (_name, receipt, expected) => {
    expect(checkReproReceipt(receipt, approval)).toBe(expected);
  });
});

describe('summarizeReproReceipt', () => {
  /** The macOS outcome for a matching run: enforced, but no denial log to observe. */
  const UNOBSERVED_PASS: ReproVerdict = {
    overall: 'pass',
    output: 'pass',
    enforcement: 'enforced',
    compliance: 'not-observed',
    evidence: 'unavailable',
  };
  const EVIDENCE_REQUIRED: ReproPolicyV1 = {
    ...DEFAULT_REPRO_REQUEST,
    evidence: { denials: 'required' },
  };
  const MEMORY_BOUNDED: ReproPolicyV1 = {
    ...DEFAULT_REPRO_REQUEST,
    limits: { ...DEFAULT_REPRO_REQUEST.limits, memoryBytes: 64 * 1024 * 1024 },
  };
  const DENIED_READ = { operation: 'file-read', area: 'outside' } as const;

  it.each<[string, ReproLaunchedReceiptV1 | ReproRefusedReceiptV1, ReproPolicyV1, ReproVerdict]>([
    [
      'a refused launch runs nothing',
      refused(),
      DEFAULT_REPRO_REQUEST,
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
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, compliance: 'clean', evidence: 'complete' },
    ],
    [
      'a match without denial evidence passes but is not observed as clean',
      launched(),
      DEFAULT_REPRO_REQUEST,
      UNOBSERVED_PASS,
    ],
    [
      'a caught denial fails even when the output matches',
      launched({ evidence: { coverage: 'complete', denials: [DENIED_READ] } }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'fail', compliance: 'violated', evidence: 'complete' },
    ],
    [
      'a denial in partial evidence still fails',
      launched({ evidence: { coverage: 'partial', denials: [DENIED_READ] } }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'fail', compliance: 'violated', evidence: 'partial' },
    ],
    [
      'a denial fails even when the output was clipped',
      launched({
        execution: { ...launched().execution, outputTruncated: true },
        evidence: { coverage: 'complete', denials: [DENIED_READ] },
      }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'fail', compliance: 'violated', evidence: 'complete' },
    ],
    [
      'an output mismatch fails',
      launched({ comparison: 'fail' }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'fail', output: 'fail' },
    ],
    [
      'clipped output is incomplete even when the comparison says pass',
      launched({ execution: { ...launched().execution, outputTruncated: true } }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'incomplete' },
    ],
    [
      'a timeout is incomplete rather than an output failure',
      launched({
        execution: {
          ...launched().execution,
          status: 'timeout',
          exitCode: null,
          signal: 'SIGKILL',
        },
        comparison: 'fail',
      }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'incomplete', output: 'fail' },
    ],
    [
      'a stopped run is incomplete',
      launched({
        execution: {
          ...launched().execution,
          status: 'stopped',
          exitCode: null,
          signal: 'SIGTERM',
        },
        comparison: 'fail',
      }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'incomplete', output: 'fail' },
    ],
    [
      'an inconclusive comparison is incomplete',
      launched({ comparison: 'inconclusive' }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'incomplete', output: 'inconclusive' },
    ],
    [
      'required evidence that is only partial is incomplete',
      launched({
        controls: withControl({ control: 'denial-evidence', support: 'enforced', required: true }),
        evidence: { coverage: 'partial', denials: [] },
      }),
      EVIDENCE_REQUIRED,
      { ...UNOBSERVED_PASS, overall: 'incomplete', evidence: 'partial' },
    ],
    [
      'a receipt that marks required evidence as optional is still judged by the policy',
      launched(),
      EVIDENCE_REQUIRED,
      { ...UNOBSERVED_PASS, overall: 'incomplete', enforcement: 'gaps' },
    ],
    [
      'a failed evidence collector is incomplete even when evidence was optional',
      launched({ evidence: { coverage: 'collection-failed', denials: [] } }),
      DEFAULT_REPRO_REQUEST,
      { ...UNOBSERVED_PASS, overall: 'incomplete', evidence: 'collection-failed' },
    ],
    [
      'a required control that was only sampled is incomplete',
      launched(),
      MEMORY_BOUNDED,
      { ...UNOBSERVED_PASS, overall: 'incomplete', enforcement: 'gaps' },
    ],
  ])('%s', (_name, receipt, approvedPolicy, expected) => {
    expect(summarizeReproReceipt(receipt, approvedPolicy)).toEqual(expected);
  });
});
