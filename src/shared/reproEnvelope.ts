/**
 * Execution envelope for a permissioned reproduction.
 *
 * Wraps one `RunCapsuleV1` (entry source and expected output) with optional
 * supplemental files, the requested runtime and the requested policy, without
 * changing the capsule or Capsule Workspace formats. Building, parsing and
 * digesting never execute code. See docs/PERMISSIONED_REPRO_ADR.md.
 */

import { redactSecretsFromCode } from './ai/explainError';
import {
  MAX_CAPSULE_WORKSPACE_BYTES,
  normalizeCapsuleWorkspacePath,
  validateCapsuleWorkspaceFileInputs,
  type CapsuleWorkspaceFileInput,
  type CapsuleWorkspaceFileV1,
  type CapsuleWorkspaceRejectReason,
} from './capsuleWorkspace';
import {
  MAX_CAPSULE_BYTES,
  computeContentHash,
  parseRunCapsule,
  sanitizeRunCapsule,
  utf8ByteLength,
  type RunCapsuleV1,
} from './runCapsule';
import {
  computeReproPolicyDigest,
  findUnknownKey,
  isRecord,
  isReproPolicyWithin,
  narrowReproPolicy,
  parseReproPolicy,
  type ReproPolicyV1,
} from './reproPolicy';

const REPRO_ENVELOPE_KIND = 'lingua-repro-envelope' as const;
const REPRO_ENVELOPE_VERSION = 1 as const;

export const MAX_REPRO_ENVELOPE_BYTES = MAX_CAPSULE_WORKSPACE_BYTES;
export const REPRO_NODE_MAJOR_RANGE = { min: 18, max: 99 } as const;

const HASH_RE = /^[a-f0-9]{64}$/u;
// The extension fixes the module format without a package.json.
const ENTRY_EXTENSION_RE = /\.(?:mjs|cjs)$/u;
const ENVELOPE_KEYS = [
  'kind',
  'version',
  'createdAt',
  'entry',
  'runtime',
  'capsule',
  'files',
  'request',
  'privacy',
] as const;

export interface ReproRuntimeV1 {
  readonly name: 'node';
  readonly major: number;
}

interface ReproEnvelopePrivacyV1 {
  readonly sourceReview: 'explicit';
  readonly absolutePathsIncluded: false;
  /** Recomputed on parse; content is preserved for an exact reproduction. */
  readonly obviousSecretsDetected: number;
}

export interface ReproEnvelopeV1 {
  readonly kind: typeof REPRO_ENVELOPE_KIND;
  readonly version: typeof REPRO_ENVELOPE_VERSION;
  readonly createdAt: string;
  /** Relative path the capsule source is staged at. */
  readonly entry: string;
  readonly runtime: ReproRuntimeV1;
  readonly capsule: RunCapsuleV1;
  /** Supplemental files; may be empty. */
  readonly files: readonly CapsuleWorkspaceFileV1[];
  /** What the artifact asks for. It never grants itself anything. */
  readonly request: ReproPolicyV1;
  readonly privacy: ReproEnvelopePrivacyV1;
}

export type ReproEnvelopeRejectReason =
  | Exclude<CapsuleWorkspaceRejectReason, 'invalid-json' | 'unsupported-version'>
  | 'invalid-json'
  | 'unsupported-version'
  | 'unknown-key'
  | 'unsupported-language'
  | 'invalid-entry'
  | 'unsupported-runtime'
  | 'invalid-policy';

type Rejection = {
  readonly ok: false;
  readonly reason: ReproEnvelopeRejectReason;
  readonly detail?: string;
};

export type BuildReproEnvelopeResult =
  { readonly ok: true; readonly value: ReproEnvelopeV1; readonly json: string } | Rejection;

export type ParseReproEnvelopeResult =
  { readonly ok: true; readonly value: ReproEnvelopeV1 } | Rejection;

export interface BuildReproEnvelopeInput {
  readonly capsule: RunCapsuleV1;
  readonly entry: string;
  readonly runtime: ReproRuntimeV1;
  readonly files: readonly CapsuleWorkspaceFileInput[];
  readonly request: ReproPolicyV1;
  readonly createdAtMs?: number;
}

function validateRuntime(raw: unknown): ReproRuntimeV1 | null {
  if (!isRecord(raw) || findUnknownKey(raw, ['name', 'major'])) return null;
  const { name, major } = raw;
  if (
    name !== 'node' ||
    typeof major !== 'number' ||
    !Number.isInteger(major) ||
    major < REPRO_NODE_MAJOR_RANGE.min ||
    major > REPRO_NODE_MAJOR_RANGE.max
  ) {
    return null;
  }
  return { name, major };
}

function validateEntry(raw: unknown, files: readonly CapsuleWorkspaceFileInput[]): string | null {
  if (typeof raw !== 'string') return null;
  const entry = normalizeCapsuleWorkspacePath(raw);
  if (!entry || entry !== raw || !ENTRY_EXTENSION_RE.test(entry)) return null;
  const key = entry.toLocaleLowerCase('en-US');
  return files.some(file => file.path.toLocaleLowerCase('en-US') === key) ? null : entry;
}

function validateCapsule(raw: unknown): { ok: true; value: RunCapsuleV1 } | Rejection {
  let json: string;
  try {
    json = JSON.stringify(raw);
  } catch {
    return { ok: false, reason: 'invalid-capsule', detail: 'not serializable' };
  }
  if (typeof json !== 'string' || utf8ByteLength(json) > MAX_CAPSULE_BYTES) {
    return { ok: false, reason: 'invalid-capsule', detail: 'oversized' };
  }
  const parsed = parseRunCapsule(json);
  if (!parsed.ok) return { ok: false, reason: 'invalid-capsule', detail: parsed.reason };
  if (parsed.value.tab.language !== 'javascript') {
    return { ok: false, reason: 'unsupported-language', detail: parsed.value.tab.language };
  }
  return { ok: true, value: sanitizeRunCapsule(parsed.value) };
}

function countObviousSecrets(
  capsule: RunCapsuleV1,
  files: readonly CapsuleWorkspaceFileInput[]
): number {
  return [capsule.source.content, ...files.map(file => file.content)].reduce(
    (count, content) => count + redactSecretsFromCode(content).redactedCount,
    0
  );
}

function validateFiles(
  files: readonly CapsuleWorkspaceFileInput[]
): { ok: true; files: readonly CapsuleWorkspaceFileInput[] } | Rejection {
  // The workspace guard rejects an empty list; an envelope may have none.
  return files.length === 0 ? { ok: true, files: [] } : validateCapsuleWorkspaceFileInputs(files);
}

export async function buildReproEnvelope(
  input: BuildReproEnvelopeInput
): Promise<BuildReproEnvelopeResult> {
  const createdAtMs = input.createdAtMs ?? Date.now();
  if (!Number.isFinite(createdAtMs)) {
    return { ok: false, reason: 'invalid-shape', detail: 'createdAt' };
  }
  if (!Array.isArray(input.files)) return { ok: false, reason: 'invalid-shape', detail: 'files' };
  const files = validateFiles(input.files);
  if (!files.ok) return files;
  const capsule = validateCapsule(input.capsule);
  if (!capsule.ok) return capsule;
  const entry = validateEntry(input.entry, files.files);
  if (!entry) return { ok: false, reason: 'invalid-entry', detail: String(input.entry) };
  const runtime = validateRuntime(input.runtime);
  if (!runtime) return { ok: false, reason: 'unsupported-runtime' };
  const request = parseReproPolicy(input.request);
  if (!request.ok) {
    return { ok: false, reason: 'invalid-policy', detail: `${request.reason}:${request.detail}` };
  }

  const hashedFiles: CapsuleWorkspaceFileV1[] = [];
  for (const file of files.files) {
    hashedFiles.push({ ...file, contentHash: await computeContentHash(file.content) });
  }
  const value: ReproEnvelopeV1 = {
    kind: REPRO_ENVELOPE_KIND,
    version: REPRO_ENVELOPE_VERSION,
    createdAt: new Date(createdAtMs).toISOString(),
    entry,
    runtime,
    capsule: capsule.value,
    files: hashedFiles,
    request: request.value,
    privacy: {
      sourceReview: 'explicit',
      absolutePathsIncluded: false,
      obviousSecretsDetected: countObviousSecrets(capsule.value, files.files),
    },
  };
  const json = JSON.stringify(value, null, 2);
  if (utf8ByteLength(json) > MAX_REPRO_ENVELOPE_BYTES) {
    return { ok: false, reason: 'artifact-too-large' };
  }
  return { ok: true, value, json };
}

/** Structural validation of an untrusted envelope; hashes are checked by the digest. */
export function parseReproEnvelope(json: string): ParseReproEnvelopeResult {
  if (typeof json !== 'string' || json.length === 0) {
    return { ok: false, reason: 'invalid-json', detail: 'empty input' };
  }
  if (utf8ByteLength(json) > MAX_REPRO_ENVELOPE_BYTES) {
    return { ok: false, reason: 'artifact-too-large' };
  }
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
  if (!isRecord(raw) || raw.kind !== REPRO_ENVELOPE_KIND) {
    return { ok: false, reason: 'invalid-shape', detail: 'kind' };
  }
  if (raw.version !== REPRO_ENVELOPE_VERSION) {
    return { ok: false, reason: 'unsupported-version', detail: `version=${String(raw.version)}` };
  }
  const unknown = findUnknownKey(raw, ENVELOPE_KEYS);
  if (unknown) return { ok: false, reason: 'unknown-key', detail: unknown };
  if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) {
    return { ok: false, reason: 'invalid-shape', detail: 'createdAt' };
  }
  if (
    !isRecord(raw.privacy) ||
    findUnknownKey(raw.privacy, [
      'sourceReview',
      'absolutePathsIncluded',
      'obviousSecretsDetected',
    ]) ||
    raw.privacy.sourceReview !== 'explicit' ||
    raw.privacy.absolutePathsIncluded !== false ||
    !Number.isInteger(raw.privacy.obviousSecretsDetected) ||
    (raw.privacy.obviousSecretsDetected as number) < 0
  ) {
    return { ok: false, reason: 'invalid-shape', detail: 'privacy' };
  }

  if (!Array.isArray(raw.files)) return { ok: false, reason: 'invalid-shape', detail: 'files' };
  const inputs: CapsuleWorkspaceFileInput[] = [];
  const hashes: string[] = [];
  for (const file of raw.files as unknown[]) {
    if (
      !isRecord(file) ||
      findUnknownKey(file, ['path', 'language', 'content', 'contentHash']) ||
      typeof file.path !== 'string' ||
      typeof file.language !== 'string' ||
      typeof file.content !== 'string' ||
      typeof file.contentHash !== 'string' ||
      !HASH_RE.test(file.contentHash)
    ) {
      return { ok: false, reason: 'invalid-shape', detail: 'file fields' };
    }
    inputs.push({ path: file.path, language: file.language, content: file.content });
    hashes.push(file.contentHash);
  }
  const files = validateFiles(inputs);
  if (!files.ok) return files;
  // Stored paths must already be portable; normalizing them would change what was reviewed.
  if (files.files.some((file, index) => file.path !== inputs[index]?.path)) {
    return { ok: false, reason: 'invalid-path' };
  }

  const capsule = validateCapsule(raw.capsule);
  if (!capsule.ok) return capsule;
  const entry = validateEntry(raw.entry, files.files);
  if (!entry) return { ok: false, reason: 'invalid-entry', detail: String(raw.entry) };
  const runtime = validateRuntime(raw.runtime);
  if (!runtime) return { ok: false, reason: 'unsupported-runtime' };
  const request = parseReproPolicy(raw.request);
  if (!request.ok) {
    return { ok: false, reason: 'invalid-policy', detail: `${request.reason}:${request.detail}` };
  }

  return {
    ok: true,
    value: {
      kind: REPRO_ENVELOPE_KIND,
      version: REPRO_ENVELOPE_VERSION,
      createdAt: raw.createdAt,
      entry,
      runtime,
      capsule: capsule.value,
      files: files.files.map((file, index) => ({ ...file, contentHash: hashes[index]! })),
      request: request.value,
      privacy: {
        sourceReview: 'explicit',
        absolutePathsIncluded: false,
        obviousSecretsDetected: countObviousSecrets(capsule.value, files.files),
      },
    },
  };
}

export type ReproContentDigestResult =
  | { readonly ok: true; readonly digest: string }
  | { readonly ok: false; readonly reason: 'hash-mismatch'; readonly path: string };

/**
 * SHA-256 over everything that decides what runs and what counts as a match: entry
 * path, runtime, stdin and args, expected streams, and every file recomputed from
 * content. There is no digest for an envelope whose stored hashes disagree with its bytes.
 */
export async function computeReproContentDigest(
  envelope: ReproEnvelopeV1
): Promise<ReproContentDigestResult> {
  // Snapshot before the first await so a caller mutation cannot mix artifacts.
  const entry = envelope.entry;
  const runtime = { name: envelope.runtime.name, major: envelope.runtime.major };
  const source = { ...envelope.capsule.source };
  const { input, result } = envelope.capsule;
  const invocation = { stdin: input.stdin ?? '', args: [...(input.args ?? [])] };
  const expected = {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  const files = envelope.files.map(({ path, content, contentHash }) => ({
    path,
    content,
    contentHash,
  }));

  if ((await computeContentHash(source.content)) !== source.contentHash) {
    return { ok: false, reason: 'hash-mismatch', path: entry };
  }
  const inventory = [{ path: entry, contentHash: source.contentHash }];
  for (const file of files) {
    if ((await computeContentHash(file.content)) !== file.contentHash) {
      return { ok: false, reason: 'hash-mismatch', path: file.path };
    }
    inventory.push({ path: file.path, contentHash: file.contentHash });
  }
  inventory.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    ok: true,
    digest: await computeContentHash(
      JSON.stringify({ entry, runtime, invocation, expected, inventory })
    ),
  };
}

/** What a recipient approved; any change to either digest needs a new review. */
export interface ReproApprovalV1 {
  readonly contentDigest: string;
  readonly policyDigest: string;
}

export type ApproveReproEnvelopeResult =
  | { readonly ok: true; readonly policy: ReproPolicyV1; readonly approval: ReproApprovalV1 }
  | { readonly ok: false; readonly reason: 'hash-mismatch'; readonly path: string };

export async function approveReproEnvelope(
  envelope: ReproEnvelopeV1,
  localCeiling: ReproPolicyV1
): Promise<ApproveReproEnvelopeResult> {
  const content = await computeReproContentDigest(envelope);
  if (!content.ok) return content;
  const policy = narrowReproPolicy(envelope.request, localCeiling);
  return {
    ok: true,
    policy,
    approval: {
      contentDigest: content.digest,
      policyDigest: await computeReproPolicyDigest(policy),
    },
  };
}

export type ReproApprovalCheck =
  'valid' | 'hash-mismatch' | 'content-changed' | 'policy-wider-than-request' | 'policy-changed';

export async function checkReproApproval(
  envelope: ReproEnvelopeV1,
  policy: ReproPolicyV1,
  approval: ReproApprovalV1
): Promise<ReproApprovalCheck> {
  const content = await computeReproContentDigest(envelope);
  if (!content.ok) return 'hash-mismatch';
  if (content.digest !== approval.contentDigest) return 'content-changed';
  if (!isReproPolicyWithin(policy, envelope.request)) return 'policy-wider-than-request';
  if ((await computeReproPolicyDigest(policy)) !== approval.policyDigest) return 'policy-changed';
  return 'valid';
}
