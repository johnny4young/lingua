import { describe, expect, it } from 'vitest';
import { CLI_OUTPUT_PAYLOAD_BYTES } from '../../src/shared/capsuleVerification';
import {
  DEFAULT_REPRO_REQUEST,
  REPRO_CONTROLS,
  computeReproEffectivePolicyDigest,
  computeReproPolicyDigest,
  isReproPolicyWithin,
  narrowReproPolicy,
  parseReproPolicy,
  requiredReproControls,
  resolveReproEffectivePolicy,
  type ReproBackendProbe,
  type ReproControl,
  type ReproControlSupport,
  type ReproPolicyV1,
} from '../../src/shared/reproPolicy';

const MIB = 1024 * 1024;

function policy(overrides: {
  filesystem?: Partial<ReproPolicyV1['filesystem']>;
  limits?: Partial<ReproPolicyV1['limits']>;
  evidence?: ReproPolicyV1['evidence'];
}): ReproPolicyV1 {
  return {
    filesystem: { ...DEFAULT_REPRO_REQUEST.filesystem, ...overrides.filesystem },
    network: 'deny',
    limits: { ...DEFAULT_REPRO_REQUEST.limits, ...overrides.limits },
    evidence: overrides.evidence ?? DEFAULT_REPRO_REQUEST.evidence,
  };
}

function probe(
  overrides: Partial<Record<ReproControl, ReproControlSupport>> = {}
): ReproBackendProbe {
  const controls = Object.fromEntries(
    REPRO_CONTROLS.map(control => [control, 'enforced'])
  ) as Record<ReproControl, ReproControlSupport>;
  return {
    backend: { id: 'test-backend', version: '1' },
    controls: { ...controls, ...overrides },
    ambientGrants: ['runtime-binary', 'os-libraries'],
  };
}

/** What the macOS Seatbelt spike measured: no denial log, memory and disk only polled. */
const SEATBELT_LIKE_PROBE = probe({
  'memory-limit': 'sampled',
  'disk-limit': 'sampled',
  'denial-evidence': 'unsupported',
});

describe('parseReproPolicy', () => {
  it('accepts the default request unchanged', () => {
    expect(parseReproPolicy(JSON.parse(JSON.stringify(DEFAULT_REPRO_REQUEST)))).toEqual({
      ok: true,
      value: DEFAULT_REPRO_REQUEST,
    });
  });

  it.each<[string, (raw: ReproPolicyV1) => unknown, string, string]>([
    ['a non-object policy', () => 'deny', 'invalid-shape', 'policy'],
    ['an unknown top-level key', raw => ({ ...raw, shell: true }), 'unknown-key', 'shell'],
    [
      'an unknown filesystem key',
      raw => ({ ...raw, filesystem: { ...raw.filesystem, home: 'read-only' } }),
      'unknown-key',
      'filesystem.home',
    ],
    [
      'an unknown limit',
      raw => ({ ...raw, limits: { ...raw.limits, cpuMs: 10 } }),
      'unknown-key',
      'limits.cpuMs',
    ],
    [
      'an unknown evidence key',
      raw => ({ ...raw, evidence: { ...raw.evidence, audit: true } }),
      'unknown-key',
      'evidence.audit',
    ],
    [
      'network other than deny',
      raw => ({ ...raw, network: 'allow' }),
      'unsupported-value',
      'network',
    ],
    [
      'writable inputs',
      raw => ({ ...raw, filesystem: { ...raw.filesystem, inputs: 'read-write' } }),
      'unsupported-value',
      'filesystem.inputs',
    ],
    [
      'an unknown scratch mode',
      raw => ({ ...raw, filesystem: { ...raw.filesystem, scratch: 'write-only' } }),
      'unsupported-value',
      'filesystem.scratch',
    ],
    [
      'permissive audit evidence',
      raw => ({ ...raw, evidence: { denials: 'audit' } }),
      'unsupported-value',
      'evidence.denials',
    ],
    [
      'a wall clock under the minimum',
      raw => ({ ...raw, limits: { ...raw.limits, wallClockMs: 99 } }),
      'limit-out-of-range',
      'limits.wallClockMs',
    ],
    [
      'a wall clock over five minutes',
      raw => ({ ...raw, limits: { ...raw.limits, wallClockMs: 300_001 } }),
      'limit-out-of-range',
      'limits.wallClockMs',
    ],
    [
      'a fractional process count',
      raw => ({ ...raw, limits: { ...raw.limits, processes: 1.5 } }),
      'limit-out-of-range',
      'limits.processes',
    ],
    [
      'a memory limit given as a string',
      raw => ({ ...raw, limits: { ...raw.limits, memoryBytes: '64m' } }),
      'limit-out-of-range',
      'limits.memoryBytes',
    ],
    [
      'a missing network mode',
      raw => {
        const { network: _omitted, ...rest } = raw;
        return rest;
      },
      'invalid-shape',
      'network',
    ],
    [
      'a missing scratch area',
      raw => {
        const { scratch: _omitted, ...filesystem } = raw.filesystem;
        return { ...raw, filesystem };
      },
      'invalid-shape',
      'filesystem.scratch',
    ],
    [
      'missing denial evidence mode',
      raw => ({ ...raw, evidence: {} }),
      'invalid-shape',
      'evidence.denials',
    ],
    [
      'an output limit the CLI would clip',
      raw => ({ ...raw, limits: { ...raw.limits, outputBytes: CLI_OUTPUT_PAYLOAD_BYTES + 1 } }),
      'limit-out-of-range',
      'limits.outputBytes',
    ],
    [
      'a missing optional limit instead of null',
      raw => {
        const { diskBytes: _omitted, ...limits } = raw.limits;
        return { ...raw, limits };
      },
      'invalid-shape',
      'limits.diskBytes',
    ],
  ])('rejects %s', (_name, mutate, reason, detail) => {
    expect(parseReproPolicy(mutate(DEFAULT_REPRO_REQUEST))).toEqual({
      ok: false,
      reason,
      detail,
    });
  });
});

describe('narrowReproPolicy', () => {
  it.each<[string, ReproPolicyV1, ReproPolicyV1, ReproPolicyV1]>([
    [
      'keeps scratch closed when only the local ceiling allows it',
      policy({ filesystem: { scratch: 'none' } }),
      policy({ filesystem: { scratch: 'read-write' } }),
      policy({ filesystem: { scratch: 'none' } }),
    ],
    [
      'closes output when the local ceiling denies it',
      policy({ filesystem: { output: 'read-write' } }),
      policy({ filesystem: { output: 'none' } }),
      policy({ filesystem: { output: 'none' } }),
    ],
    [
      'takes the smaller wall clock, output and process limits',
      policy({ limits: { wallClockMs: 60_000, outputBytes: 4096, processes: 4 } }),
      policy({ limits: { wallClockMs: 10_000, outputBytes: 8192, processes: 1 } }),
      policy({ limits: { wallClockMs: 10_000, outputBytes: 4096, processes: 1 } }),
    ],
    [
      'adds a memory bound the request left unbounded',
      policy({ limits: { memoryBytes: null } }),
      policy({ limits: { memoryBytes: 64 * MIB } }),
      policy({ limits: { memoryBytes: 64 * MIB } }),
    ],
    [
      'keeps the request disk bound when the local ceiling is unbounded',
      policy({ limits: { diskBytes: 8 * MIB } }),
      policy({ limits: { diskBytes: null } }),
      policy({ limits: { diskBytes: 8 * MIB } }),
    ],
    [
      'requires denial evidence when the local ceiling requires it',
      policy({ evidence: { denials: 'if-available' } }),
      policy({ evidence: { denials: 'required' } }),
      policy({ evidence: { denials: 'required' } }),
    ],
  ])('%s', (_name, requested, localCeiling, expected) => {
    const approved = narrowReproPolicy(requested, localCeiling);

    expect(approved).toEqual(expected);
    expect(isReproPolicyWithin(approved, requested)).toBe(true);
    expect(isReproPolicyWithin(approved, localCeiling)).toBe(true);
  });
});

describe('isReproPolicyWithin', () => {
  it('rejects a policy that opens an area the request kept closed', () => {
    const requested = policy({ filesystem: { output: 'none' } });

    expect(isReproPolicyWithin(policy({ filesystem: { output: 'read-write' } }), requested)).toBe(
      false
    );
  });

  it('rejects a policy that drops a memory bound the request set', () => {
    const requested = policy({ limits: { memoryBytes: 64 * MIB } });

    expect(isReproPolicyWithin(policy({ limits: { memoryBytes: null } }), requested)).toBe(false);
  });

  it('accepts the request itself', () => {
    expect(isReproPolicyWithin(DEFAULT_REPRO_REQUEST, DEFAULT_REPRO_REQUEST)).toBe(true);
  });
});

describe('requiredReproControls', () => {
  it('requires the six mandatory controls for the default request', () => {
    expect(requiredReproControls(DEFAULT_REPRO_REQUEST)).toEqual([
      'filesystem-isolation',
      'network-deny',
      'process-containment',
      'wall-clock-limit',
      'output-limit',
      'process-limit',
    ]);
  });

  it('adds memory, disk and denial evidence only when the policy asks for them', () => {
    const strict = policy({
      limits: { memoryBytes: 64 * MIB, diskBytes: 8 * MIB },
      evidence: { denials: 'required' },
    });

    expect(requiredReproControls(strict)).toEqual(REPRO_CONTROLS);
  });
});

describe('computeReproPolicyDigest', () => {
  it('ignores the key order the caller used', async () => {
    const reordered: ReproPolicyV1 = {
      evidence: { denials: 'if-available' },
      limits: {
        diskBytes: null,
        memoryBytes: null,
        processes: 1,
        outputBytes: DEFAULT_REPRO_REQUEST.limits.outputBytes,
        wallClockMs: 30_000,
      },
      network: 'deny',
      filesystem: { output: 'read-write', scratch: 'read-write', inputs: 'read-only' },
    };

    expect(await computeReproPolicyDigest(reordered)).toBe(
      await computeReproPolicyDigest(DEFAULT_REPRO_REQUEST)
    );
  });

  it('changes when any field changes', async () => {
    const tighter = policy({ limits: { wallClockMs: 29_999 } });

    expect(await computeReproPolicyDigest(tighter)).not.toBe(
      await computeReproPolicyDigest(DEFAULT_REPRO_REQUEST)
    );
  });
});

describe('resolveReproEffectivePolicy', () => {
  it('lists every control with its support and whether the policy requires it', () => {
    const resolved = resolveReproEffectivePolicy(DEFAULT_REPRO_REQUEST, SEATBELT_LIKE_PROBE);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.backend).toEqual({ id: 'test-backend', version: '1' });
    expect(resolved.value.controls).toEqual([
      { control: 'filesystem-isolation', support: 'enforced', required: true },
      { control: 'network-deny', support: 'enforced', required: true },
      { control: 'process-containment', support: 'enforced', required: true },
      { control: 'wall-clock-limit', support: 'enforced', required: true },
      { control: 'output-limit', support: 'enforced', required: true },
      { control: 'process-limit', support: 'enforced', required: true },
      { control: 'memory-limit', support: 'sampled', required: false },
      { control: 'disk-limit', support: 'sampled', required: false },
      { control: 'denial-evidence', support: 'unsupported', required: false },
    ]);
    expect(resolved.value.ambientGrants).toEqual(['runtime-binary', 'os-libraries']);
  });

  it('refuses when a required control is only sampled or unsupported', () => {
    const strict = policy({
      limits: { memoryBytes: 64 * MIB },
      evidence: { denials: 'required' },
    });

    expect(resolveReproEffectivePolicy(strict, SEATBELT_LIKE_PROBE)).toEqual({
      ok: false,
      reason: 'unenforceable',
      missing: ['memory-limit', 'denial-evidence'],
    });
  });

  it('refuses when a mandatory control is missing even with no optional limits', () => {
    expect(
      resolveReproEffectivePolicy(DEFAULT_REPRO_REQUEST, probe({ 'network-deny': 'unsupported' }))
    ).toEqual({ ok: false, reason: 'unenforceable', missing: ['network-deny'] });
  });
});

describe('computeReproEffectivePolicyDigest', () => {
  async function digestFor(backendProbe: ReproBackendProbe): Promise<string> {
    const resolved = resolveReproEffectivePolicy(DEFAULT_REPRO_REQUEST, backendProbe);
    if (!resolved.ok) throw new Error('fixture probe must enforce the default request');
    return computeReproEffectivePolicyDigest(resolved.value);
  }

  it('does not depend on the order ambient grants were reported in', async () => {
    const reversed = { ...SEATBELT_LIKE_PROBE, ambientGrants: ['os-libraries', 'runtime-binary'] };

    expect(await digestFor(reversed)).toBe(await digestFor(SEATBELT_LIKE_PROBE));
  });

  it('changes when the backend needs another ambient grant', async () => {
    const wider = {
      ...SEATBELT_LIKE_PROBE,
      ambientGrants: [...SEATBELT_LIKE_PROBE.ambientGrants, 'temp-directory'],
    };

    expect(await digestFor(wider)).not.toBe(await digestFor(SEATBELT_LIKE_PROBE));
  });

  it('changes when a control changes support', async () => {
    expect(await digestFor(probe())).not.toBe(await digestFor(SEATBELT_LIKE_PROBE));
  });
});
