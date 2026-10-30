/**
 * Receipt for one permissioned reproduction and the verdict read from it.
 *
 * Output equivalence, enforcement, policy compliance and evidence coverage are
 * separate axes, so a matching output cannot hide a denial or missing evidence.
 * A receipt supports consistency checks; it authenticates nobody and proves
 * nothing safe. See docs/PERMISSIONED_REPRO_ADR.md.
 */

import type { CapsuleVerdict } from './capsuleVerification';
import { containsControlCharacter, normalizeCapsuleWorkspacePath } from './capsuleWorkspace';
import type { ReproApprovalV1 } from './reproEnvelope';
import { utf8ByteLength, type RunCapsuleStatus } from './runCapsule';
import {
  REPRO_CONTROLS,
  findUnknownKey,
  isRecord,
  requiredReproControls,
  type ReproBackendIdentity,
  type ReproControl,
  type ReproControlStatus,
  type ReproPolicyV1,
} from './reproPolicy';

const REPRO_RECEIPT_KIND = 'lingua-repro-receipt' as const;
const REPRO_RECEIPT_VERSION = 1 as const;

export const MAX_REPRO_DENIALS = 256;
export const MAX_REPRO_RECEIPT_BYTES = 256 * 1024;
const MAX_IDENTITY_CHARS = 128;
const HASH_RE = /^[a-f0-9]{64}$/u;

const DENIAL_OPERATIONS = ['file-read', 'file-write', 'network', 'process-spawn', 'other'] as const;
const DENIAL_AREAS = ['inputs', 'scratch', 'output', 'outside'] as const;
const EVIDENCE_COVERAGES = ['complete', 'partial', 'unavailable', 'collection-failed'] as const;
const REFUSAL_REASONS = ['backend-unavailable', 'unenforceable', 'approval-invalid'] as const;
const RUN_STATUSES = ['success', 'error', 'timeout', 'stopped'] as const;
const COMPARISON_VERDICTS = ['pass', 'fail', 'inconclusive'] as const;
const CONTROL_SUPPORTS = ['enforced', 'sampled', 'unsupported'] as const;

export type ReproDenialOperation = (typeof DENIAL_OPERATIONS)[number];
export type ReproDenialArea = (typeof DENIAL_AREAS)[number];
export type ReproEvidenceCoverage = (typeof EVIDENCE_COVERAGES)[number];
export type ReproRefusalReason = (typeof REFUSAL_REASONS)[number];

/** A path is kept only inside a staging area, relative to it; `outside` never has one. */
export interface ReproDenialV1 {
  readonly operation: ReproDenialOperation;
  readonly area: ReproDenialArea;
  readonly path?: string;
}

export interface ReproReceiptHostV1 {
  readonly lingua: string;
  readonly os: string;
  readonly arch: string;
  readonly runtime: string | null;
  readonly backend: ReproBackendIdentity | null;
}

interface ReproReceiptBaseV1 {
  readonly kind: typeof REPRO_RECEIPT_KIND;
  readonly version: typeof REPRO_RECEIPT_VERSION;
  readonly createdAt: string;
  readonly contentDigest: string;
  readonly approvedPolicyDigest: string;
  readonly host: ReproReceiptHostV1;
}

export interface ReproRefusedReceiptV1 extends ReproReceiptBaseV1 {
  readonly launch: 'refused';
  readonly refusalReason: ReproRefusalReason;
  /** Required controls the backend could not enforce; empty for other reasons. */
  readonly missingControls: readonly ReproControl[];
}

export interface ReproExecutionV1 {
  readonly status: RunCapsuleStatus;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outputTruncated: boolean;
}

export interface ReproEvidenceV1 {
  readonly coverage: ReproEvidenceCoverage;
  readonly denials: readonly ReproDenialV1[];
}

export interface ReproLaunchedReceiptV1 extends ReproReceiptBaseV1 {
  readonly launch: 'launched';
  readonly effectivePolicyDigest: string;
  /** Every control in `REPRO_CONTROLS` order, as the effective policy resolved it. */
  readonly controls: readonly ReproControlStatus[];
  readonly execution: ReproExecutionV1;
  readonly comparison: CapsuleVerdict;
  readonly evidence: ReproEvidenceV1;
}

export type ReproReceiptV1 = ReproRefusedReceiptV1 | ReproLaunchedReceiptV1;

export type ParseReproReceiptResult =
  | { readonly ok: true; readonly value: ReproReceiptV1 }
  | {
      readonly ok: false;
      readonly reason: 'invalid-json' | 'unsupported-version' | 'invalid-shape' | 'too-large';
      readonly detail?: string;
    };

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Short printable token; slashes are refused so a host path cannot ride along. */
function isIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_IDENTITY_CHARS &&
    !containsControlCharacter(value) &&
    !/[/\\]/u.test(value)
  );
}

function parseHost(raw: unknown): ReproReceiptHostV1 | null {
  if (!isRecord(raw) || findUnknownKey(raw, ['lingua', 'os', 'arch', 'runtime', 'backend'])) {
    return null;
  }
  const { lingua, os, arch, runtime, backend } = raw;
  if (!isIdentity(lingua) || !isIdentity(os) || !isIdentity(arch)) return null;
  if (runtime !== null && !isIdentity(runtime)) return null;
  if (backend === null) return { lingua, os, arch, runtime, backend: null };
  if (
    !isRecord(backend) ||
    findUnknownKey(backend, ['id', 'version']) ||
    !isIdentity(backend.id) ||
    !isIdentity(backend.version)
  ) {
    return null;
  }
  return { lingua, os, arch, runtime, backend: { id: backend.id, version: backend.version } };
}

function parseControls(raw: unknown): ReproControlStatus[] | null {
  if (!Array.isArray(raw) || raw.length !== REPRO_CONTROLS.length) return null;
  const controls: ReproControlStatus[] = [];
  for (const [index, control] of REPRO_CONTROLS.entries()) {
    const entry: unknown = raw[index];
    if (
      !isRecord(entry) ||
      findUnknownKey(entry, ['control', 'support', 'required']) ||
      entry.control !== control ||
      !isOneOf(CONTROL_SUPPORTS, entry.support) ||
      typeof entry.required !== 'boolean'
    ) {
      return null;
    }
    controls.push({ control, support: entry.support, required: entry.required });
  }
  return controls;
}

function parseDenial(raw: unknown): ReproDenialV1 | null {
  if (!isRecord(raw) || findUnknownKey(raw, ['operation', 'area', 'path'])) return null;
  const { operation, area, path } = raw;
  if (!isOneOf(DENIAL_OPERATIONS, operation) || !isOneOf(DENIAL_AREAS, area)) return null;
  if (path === undefined) return { operation, area };
  if (area === 'outside' || typeof path !== 'string') return null;
  return normalizeCapsuleWorkspacePath(path) === path ? { operation, area, path } : null;
}

function parseEvidence(raw: unknown): ReproEvidenceV1 | null {
  if (!isRecord(raw) || findUnknownKey(raw, ['coverage', 'denials'])) return null;
  const { coverage, denials } = raw;
  if (!isOneOf(EVIDENCE_COVERAGES, coverage) || !Array.isArray(denials)) return null;
  if (denials.length > MAX_REPRO_DENIALS) return null;
  if (coverage === 'unavailable' && denials.length > 0) return null;
  const parsed: ReproDenialV1[] = [];
  for (const denial of denials as unknown[]) {
    const value = parseDenial(denial);
    if (!value) return null;
    parsed.push(value);
  }
  return { coverage, denials: parsed };
}

function parseExecution(raw: unknown): ReproExecutionV1 | null {
  if (
    !isRecord(raw) ||
    findUnknownKey(raw, ['status', 'exitCode', 'signal', 'startedAt', 'endedAt', 'outputTruncated'])
  ) {
    return null;
  }
  const { status, exitCode, signal, startedAt, endedAt, outputTruncated } = raw;
  if (
    !isOneOf(RUN_STATUSES, status) ||
    !(exitCode === null || Number.isInteger(exitCode)) ||
    !(signal === null || isIdentity(signal)) ||
    !isIsoDate(startedAt) ||
    !isIsoDate(endedAt) ||
    Date.parse(endedAt) < Date.parse(startedAt) ||
    typeof outputTruncated !== 'boolean' ||
    (status === 'success' && (exitCode !== 0 || signal !== null))
  ) {
    return null;
  }
  return {
    status,
    exitCode: exitCode as number | null,
    signal: signal as string | null,
    startedAt,
    endedAt,
    outputTruncated,
  };
}

const BASE_KEYS = [
  'kind',
  'version',
  'createdAt',
  'contentDigest',
  'approvedPolicyDigest',
  'host',
  'launch',
];
const REFUSED_KEYS = [...BASE_KEYS, 'refusalReason', 'missingControls'];
const LAUNCHED_KEYS = [
  ...BASE_KEYS,
  'effectivePolicyDigest',
  'controls',
  'execution',
  'comparison',
  'evidence',
];

/** Strict validation of an untrusted receipt; unknown keys are rejected at every level. */
export function parseReproReceipt(json: string): ParseReproReceiptResult {
  if (typeof json !== 'string' || json.length === 0) {
    return { ok: false, reason: 'invalid-json', detail: 'empty input' };
  }
  if (utf8ByteLength(json) > MAX_REPRO_RECEIPT_BYTES) return { ok: false, reason: 'too-large' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-json',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!isRecord(raw) || raw.kind !== REPRO_RECEIPT_KIND) {
    return { ok: false, reason: 'invalid-shape', detail: 'kind' };
  }
  if (raw.version !== REPRO_RECEIPT_VERSION) {
    return { ok: false, reason: 'unsupported-version', detail: `version=${String(raw.version)}` };
  }
  const invalid = (detail: string): ParseReproReceiptResult => ({
    ok: false,
    reason: 'invalid-shape',
    detail,
  });
  const { createdAt, contentDigest, approvedPolicyDigest } = raw;
  if (!isIsoDate(createdAt)) return invalid('createdAt');
  if (typeof contentDigest !== 'string' || !HASH_RE.test(contentDigest)) {
    return invalid('contentDigest');
  }
  if (typeof approvedPolicyDigest !== 'string' || !HASH_RE.test(approvedPolicyDigest)) {
    return invalid('approvedPolicyDigest');
  }
  const host = parseHost(raw.host);
  if (!host) return invalid('host');
  const base = {
    kind: REPRO_RECEIPT_KIND,
    version: REPRO_RECEIPT_VERSION,
    createdAt,
    contentDigest,
    approvedPolicyDigest,
    host,
  };

  if (raw.launch === 'refused') {
    const unknown = findUnknownKey(raw, REFUSED_KEYS);
    if (unknown) return invalid(unknown);
    const { refusalReason, missingControls } = raw;
    if (!isOneOf(REFUSAL_REASONS, refusalReason)) return invalid('refusalReason');
    if (
      !Array.isArray(missingControls) ||
      !(missingControls as unknown[]).every(control => isOneOf(REPRO_CONTROLS, control)) ||
      new Set(missingControls).size !== missingControls.length ||
      (refusalReason === 'unenforceable') !== missingControls.length > 0
    ) {
      return invalid('missingControls');
    }
    // Only a probed backend can report which controls it lacks.
    if (refusalReason === 'unenforceable' && !host.backend) return invalid('host');
    return {
      ok: true,
      value: {
        ...base,
        launch: 'refused',
        refusalReason,
        missingControls: missingControls as ReproControl[],
      },
    };
  }

  if (raw.launch !== 'launched') return invalid('launch');
  const unknown = findUnknownKey(raw, LAUNCHED_KEYS);
  if (unknown) return invalid(unknown);
  const { effectivePolicyDigest, comparison } = raw;
  if (typeof effectivePolicyDigest !== 'string' || !HASH_RE.test(effectivePolicyDigest)) {
    return invalid('effectivePolicyDigest');
  }
  if (!host.backend || !host.runtime) return invalid('host');
  const controls = parseControls(raw.controls);
  if (!controls) return invalid('controls');
  const execution = parseExecution(raw.execution);
  if (!execution) return invalid('execution');
  if (!isOneOf(COMPARISON_VERDICTS, comparison)) return invalid('comparison');
  const evidence = parseEvidence(raw.evidence);
  if (!evidence) return invalid('evidence');
  return {
    ok: true,
    value: {
      ...base,
      launch: 'launched',
      effectivePolicyDigest,
      controls,
      execution,
      comparison,
      evidence,
    },
  };
}

export interface ReproVerdict {
  readonly overall: 'pass' | 'fail' | 'incomplete' | 'refused';
  readonly output: CapsuleVerdict | 'not-run';
  readonly enforcement: 'enforced' | 'gaps' | 'not-run';
  /** `not-observed` is not `clean`: a missing denial does not mean nothing was attempted. */
  readonly compliance: 'clean' | 'violated' | 'not-observed' | 'not-run';
  readonly evidence: ReproEvidenceCoverage | 'not-run';
}

export type ReproReceiptCheck = 'consistent' | 'content-mismatch' | 'policy-mismatch';

/** Whether a receipt describes the reviewed inputs and policy; it authenticates nothing. */
export function checkReproReceipt(
  receipt: ReproReceiptV1,
  approval: ReproApprovalV1
): ReproReceiptCheck {
  if (receipt.contentDigest !== approval.contentDigest) return 'content-mismatch';
  if (receipt.approvedPolicyDigest !== approval.policyDigest) return 'policy-mismatch';
  return 'consistent';
}

/**
 * Required controls come from the approved policy, never from the receipt's own
 * flags. Check the receipt against the approval with `checkReproReceipt` first.
 */
export function summarizeReproReceipt(
  receipt: ReproReceiptV1,
  approvedPolicy: ReproPolicyV1
): ReproVerdict {
  if (receipt.launch === 'refused') {
    return {
      overall: 'refused',
      output: 'not-run',
      enforcement: 'not-run',
      compliance: 'not-run',
      evidence: 'not-run',
    };
  }
  const { controls, comparison, evidence, execution } = receipt;
  const required = requiredReproControls(approvedPolicy);
  const enforcement = required.every(
    control => controls.find(status => status.control === control)?.support === 'enforced'
  )
    ? 'enforced'
    : 'gaps';
  const compliance =
    evidence.denials.length > 0
      ? 'violated'
      : evidence.coverage === 'complete'
        ? 'clean'
        : 'not-observed';
  // Mirrors strict CLI verification: clipped or interrupted output is missing evidence.
  const executionIncomplete =
    execution.outputTruncated || execution.status === 'timeout' || execution.status === 'stopped';

  let overall: ReproVerdict['overall'];
  if (compliance === 'violated') {
    overall = 'fail';
  } else if (executionIncomplete) {
    overall = 'incomplete';
  } else if (comparison === 'fail') {
    overall = 'fail';
  } else if (
    enforcement === 'gaps' ||
    comparison === 'inconclusive' ||
    evidence.coverage === 'collection-failed' ||
    (approvedPolicy.evidence.denials === 'required' && evidence.coverage !== 'complete')
  ) {
    overall = 'incomplete';
  } else {
    overall = 'pass';
  }
  return { overall, output: comparison, enforcement, compliance, evidence: evidence.coverage };
}
