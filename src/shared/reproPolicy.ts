/**
 * Permission policy for a permissioned reproduction.
 *
 * Requested, approved and effective policies stay distinct (see
 * docs/PERMISSIONED_REPRO_ADR.md). Pure data and validation: nothing here
 * launches, sandboxes or grants anything.
 */

import { computeContentHash } from './contentHash';
import { CLI_OUTPUT_PAYLOAD_BYTES } from './capsuleVerification';

const MIB = 1024 * 1024;

/** Schema bounds only; a backend may still refuse a value it cannot enforce. */
export const REPRO_LIMIT_BOUNDS = {
  wallClockMs: { min: 100, max: 5 * 60_000 },
  // The most a supervisor captures before clipping; more could never compare cleanly.
  outputBytes: { min: 1, max: CLI_OUTPUT_PAYLOAD_BYTES },
  processes: { min: 1, max: 16 },
  memoryBytes: { min: 32 * MIB, max: 8 * 1024 * MIB },
  diskBytes: { min: 1 * MIB, max: 1024 * MIB },
} as const;

export type ReproWritableArea = 'none' | 'read-write';

export interface ReproPolicyV1 {
  readonly filesystem: {
    readonly inputs: 'read-only';
    readonly scratch: ReproWritableArea;
    readonly output: ReproWritableArea;
  };
  readonly network: 'deny';
  readonly limits: {
    readonly wallClockMs: number;
    readonly outputBytes: number;
    readonly processes: number;
    /** `null` leaves the dimension unbounded, so the control is not required. */
    readonly memoryBytes: number | null;
    readonly diskBytes: number | null;
  };
  readonly evidence: { readonly denials: 'required' | 'if-available' };
}

export const DEFAULT_REPRO_REQUEST: ReproPolicyV1 = {
  filesystem: { inputs: 'read-only', scratch: 'read-write', output: 'read-write' },
  network: 'deny',
  limits: {
    wallClockMs: 30_000,
    outputBytes: CLI_OUTPUT_PAYLOAD_BYTES,
    processes: 1,
    memoryBytes: null,
    diskBytes: null,
  },
  evidence: { denials: 'if-available' },
};

export const REPRO_CONTROLS = [
  'filesystem-isolation',
  'network-deny',
  'process-containment',
  'wall-clock-limit',
  'output-limit',
  'process-limit',
  'memory-limit',
  'disk-limit',
  'denial-evidence',
] as const;

export type ReproControl = (typeof REPRO_CONTROLS)[number];

/** `sampled` means a supervisor polls from outside; it never satisfies a required control. */
export type ReproControlSupport = 'enforced' | 'sampled' | 'unsupported';

export type ReproPolicyRejectReason =
  'invalid-shape' | 'unknown-key' | 'unsupported-value' | 'limit-out-of-range';

export type ParseReproPolicyResult =
  | { readonly ok: true; readonly value: ReproPolicyV1 }
  | { readonly ok: false; readonly reason: ReproPolicyRejectReason; readonly detail: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Name of the first key outside `allowed`, or null. */
export function findUnknownKey(
  value: Record<string, unknown>,
  allowed: readonly string[]
): string | null {
  return Object.keys(value).find(key => !allowed.includes(key)) ?? null;
}

/** Name of the first key in `required` that `value` lacks, or null. */
function findMissingKey(
  value: Record<string, unknown>,
  required: readonly string[]
): string | null {
  return required.find(key => !Object.hasOwn(value, key)) ?? null;
}

type LimitName = keyof typeof REPRO_LIMIT_BOUNDS;

function isLimitInRange(name: LimitName, value: unknown): value is number {
  const bounds = REPRO_LIMIT_BOUNDS[name];
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max
  );
}

function isWritableArea(value: unknown): value is ReproWritableArea {
  return value === 'none' || value === 'read-write';
}

/** Validate an untrusted policy object; unknown keys are rejected, never ignored. */
export function parseReproPolicy(raw: unknown): ParseReproPolicyResult {
  if (!isRecord(raw)) return { ok: false, reason: 'invalid-shape', detail: 'policy' };
  const topKeys = ['filesystem', 'network', 'limits', 'evidence'];
  const unknown = findUnknownKey(raw, topKeys);
  if (unknown) return { ok: false, reason: 'unknown-key', detail: unknown };
  const missing = findMissingKey(raw, topKeys);
  if (missing) return { ok: false, reason: 'invalid-shape', detail: missing };

  const { filesystem, limits, evidence } = raw;
  if (!isRecord(filesystem)) return { ok: false, reason: 'invalid-shape', detail: 'filesystem' };
  const fsKeys = ['inputs', 'scratch', 'output'];
  const unknownFs = findUnknownKey(filesystem, fsKeys);
  if (unknownFs) return { ok: false, reason: 'unknown-key', detail: `filesystem.${unknownFs}` };
  const missingFs = findMissingKey(filesystem, fsKeys);
  if (missingFs) return { ok: false, reason: 'invalid-shape', detail: `filesystem.${missingFs}` };
  if (filesystem.inputs !== 'read-only') {
    return { ok: false, reason: 'unsupported-value', detail: 'filesystem.inputs' };
  }
  for (const area of ['scratch', 'output'] as const) {
    if (!isWritableArea(filesystem[area])) {
      return { ok: false, reason: 'unsupported-value', detail: `filesystem.${area}` };
    }
  }

  if (raw.network !== 'deny') {
    return { ok: false, reason: 'unsupported-value', detail: 'network' };
  }

  if (!isRecord(limits)) return { ok: false, reason: 'invalid-shape', detail: 'limits' };
  const limitNames = Object.keys(REPRO_LIMIT_BOUNDS) as LimitName[];
  const unknownLimit = findUnknownKey(limits, limitNames);
  if (unknownLimit) return { ok: false, reason: 'unknown-key', detail: `limits.${unknownLimit}` };
  const missingLimit = findMissingKey(limits, limitNames);
  if (missingLimit) {
    return { ok: false, reason: 'invalid-shape', detail: `limits.${missingLimit}` };
  }
  for (const name of limitNames) {
    const value = limits[name];
    const optional = name === 'memoryBytes' || name === 'diskBytes';
    if (optional && value === null) continue;
    if (!isLimitInRange(name, value)) {
      return { ok: false, reason: 'limit-out-of-range', detail: `limits.${name}` };
    }
  }

  if (!isRecord(evidence)) return { ok: false, reason: 'invalid-shape', detail: 'evidence' };
  const unknownEvidence = findUnknownKey(evidence, ['denials']);
  if (unknownEvidence) {
    return { ok: false, reason: 'unknown-key', detail: `evidence.${unknownEvidence}` };
  }
  if (!Object.hasOwn(evidence, 'denials')) {
    return { ok: false, reason: 'invalid-shape', detail: 'evidence.denials' };
  }
  if (evidence.denials !== 'required' && evidence.denials !== 'if-available') {
    return { ok: false, reason: 'unsupported-value', detail: 'evidence.denials' };
  }

  return {
    ok: true,
    value: {
      filesystem: {
        inputs: 'read-only',
        scratch: filesystem.scratch as ReproWritableArea,
        output: filesystem.output as ReproWritableArea,
      },
      network: 'deny',
      limits: {
        wallClockMs: limits.wallClockMs as number,
        outputBytes: limits.outputBytes as number,
        processes: limits.processes as number,
        memoryBytes: limits.memoryBytes as number | null,
        diskBytes: limits.diskBytes as number | null,
      },
      evidence: { denials: evidence.denials },
    },
  };
}

function stricterArea(a: ReproWritableArea, b: ReproWritableArea): ReproWritableArea {
  return a === 'read-write' && b === 'read-write' ? 'read-write' : 'none';
}

/** `null` is unbounded, so any number is stricter than it. */
function stricterOptionalLimit(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * The approved policy: every field takes the stricter of the request and the
 * recipient's local ceiling, so approval can narrow a request but never widen it.
 */
export function narrowReproPolicy(
  requested: ReproPolicyV1,
  localCeiling: ReproPolicyV1
): ReproPolicyV1 {
  return {
    filesystem: {
      inputs: 'read-only',
      scratch: stricterArea(requested.filesystem.scratch, localCeiling.filesystem.scratch),
      output: stricterArea(requested.filesystem.output, localCeiling.filesystem.output),
    },
    network: 'deny',
    limits: {
      wallClockMs: Math.min(requested.limits.wallClockMs, localCeiling.limits.wallClockMs),
      outputBytes: Math.min(requested.limits.outputBytes, localCeiling.limits.outputBytes),
      processes: Math.min(requested.limits.processes, localCeiling.limits.processes),
      memoryBytes: stricterOptionalLimit(
        requested.limits.memoryBytes,
        localCeiling.limits.memoryBytes
      ),
      diskBytes: stricterOptionalLimit(requested.limits.diskBytes, localCeiling.limits.diskBytes),
    },
    evidence: {
      denials:
        requested.evidence.denials === 'required' || localCeiling.evidence.denials === 'required'
          ? 'required'
          : 'if-available',
    },
  };
}

/** True when `inner` grants nothing that `outer` does not. */
export function isReproPolicyWithin(inner: ReproPolicyV1, outer: ReproPolicyV1): boolean {
  const narrowed = narrowReproPolicy(outer, inner);
  return canonicalReproPolicyJson(narrowed) === canonicalReproPolicyJson(inner);
}

/** Controls that must be `enforced` before the workload may launch. */
export function requiredReproControls(policy: ReproPolicyV1): readonly ReproControl[] {
  return REPRO_CONTROLS.filter(control => {
    switch (control) {
      case 'memory-limit':
        return policy.limits.memoryBytes !== null;
      case 'disk-limit':
        return policy.limits.diskBytes !== null;
      case 'denial-evidence':
        return policy.evidence.denials === 'required';
      default:
        return true;
    }
  });
}

/** Fixed key order, independent of how the caller built the object. */
function canonicalReproPolicy(policy: ReproPolicyV1): ReproPolicyV1 {
  return {
    filesystem: {
      inputs: policy.filesystem.inputs,
      scratch: policy.filesystem.scratch,
      output: policy.filesystem.output,
    },
    network: policy.network,
    limits: {
      wallClockMs: policy.limits.wallClockMs,
      outputBytes: policy.limits.outputBytes,
      processes: policy.limits.processes,
      memoryBytes: policy.limits.memoryBytes,
      diskBytes: policy.limits.diskBytes,
    },
    evidence: { denials: policy.evidence.denials },
  };
}

export function canonicalReproPolicyJson(policy: ReproPolicyV1): string {
  return JSON.stringify(canonicalReproPolicy(policy));
}

export function computeReproPolicyDigest(policy: ReproPolicyV1): Promise<string> {
  return computeContentHash(canonicalReproPolicyJson(policy));
}

export interface ReproBackendIdentity {
  readonly id: string;
  readonly version: string;
}

/** What one containment backend reports it can do on this host. */
export interface ReproBackendProbe {
  readonly backend: ReproBackendIdentity;
  readonly controls: Readonly<Record<ReproControl, ReproControlSupport>>;
  /** Host access the backend needs beyond the policy. Host-specific; never exported. */
  readonly ambientGrants: readonly string[];
}

export interface ReproControlStatus {
  readonly control: ReproControl;
  readonly support: ReproControlSupport;
  readonly required: boolean;
}

export interface ReproEffectivePolicy {
  readonly approved: ReproPolicyV1;
  readonly backend: ReproBackendIdentity;
  readonly controls: readonly ReproControlStatus[];
  readonly ambientGrants: readonly string[];
}

export type ResolveReproEffectivePolicyResult =
  | { readonly ok: true; readonly value: ReproEffectivePolicy }
  | {
      readonly ok: false;
      readonly reason: 'unenforceable';
      readonly missing: readonly ReproControl[];
    };

/** Refuses unless every required control is `enforced`; `sampled` does not count. */
export function resolveReproEffectivePolicy(
  approved: ReproPolicyV1,
  probe: ReproBackendProbe
): ResolveReproEffectivePolicyResult {
  const required = new Set(requiredReproControls(approved));
  const controls = REPRO_CONTROLS.map(control => ({
    control,
    support: probe.controls[control] ?? 'unsupported',
    required: required.has(control),
  }));
  const missing = controls
    .filter(status => status.required && status.support !== 'enforced')
    .map(status => status.control);
  if (missing.length > 0) return { ok: false, reason: 'unenforceable', missing };
  return {
    ok: true,
    value: {
      approved,
      backend: { id: probe.backend.id, version: probe.backend.version },
      controls,
      ambientGrants: [...probe.ambientGrants],
    },
  };
}

/** Covers everything that changes what the workload may do on this host. */
export function computeReproEffectivePolicyDigest(
  effective: ReproEffectivePolicy
): Promise<string> {
  return computeContentHash(
    JSON.stringify({
      approved: canonicalReproPolicy(effective.approved),
      backend: { id: effective.backend.id, version: effective.backend.version },
      controls: effective.controls.map(({ control, support, required }) => ({
        control,
        support,
        required,
      })),
      ambientGrants: [...effective.ambientGrants].sort(),
    })
  );
}
