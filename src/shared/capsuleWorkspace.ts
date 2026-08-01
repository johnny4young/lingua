/**
 * Shareable, multi-file companion artifact for one stable Run Capsule.
 *
 * This intentionally wraps `RunCapsuleV1` instead of changing its wire format:
 * CLI replay, share links, and older releases keep consuming the single-source
 * capsule unchanged. A Capsule Workspace adds only user-selected text files and
 * is designed for local export/import; it never implies a hosted backend.
 */

import { redactSecretsFromCode } from './ai/explainError';
import {
  MAX_CAPSULE_BYTES,
  computeContentHash,
  parseRunCapsule,
  sanitizeRunCapsule,
  utf8ByteLength,
  type RunCapsuleV1,
} from './runCapsule';

export const CAPSULE_WORKSPACE_KIND = 'lingua-capsule-workspace' as const;
export const CAPSULE_WORKSPACE_VERSION = 1 as const;

/** Supplemental files only; the capsule's primary source is separate. */
export const MAX_CAPSULE_WORKSPACE_FILES = 24;
export const MAX_CAPSULE_WORKSPACE_FILE_BYTES = 256 * 1024;
export const MAX_CAPSULE_WORKSPACE_TOTAL_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_CAPSULE_WORKSPACE_BYTES = 6 * 1024 * 1024;
export const MAX_CAPSULE_WORKSPACE_PATH_BYTES = 240;

const HASH_RE = /^[a-f0-9]{64}$/u;
const LANGUAGE_RE = /^[a-z][a-z0-9-]{0,31}$/u;

export interface CapsuleWorkspaceFileInput {
  readonly path: string;
  readonly language: string;
  readonly content: string;
}

export interface CapsuleWorkspaceFileV1 extends CapsuleWorkspaceFileInput {
  readonly contentHash: string;
}

export interface CapsuleWorkspacePrivacyV1 {
  /** Source files are never silently attached; the exporter requires review. */
  readonly sourceReview: 'explicit';
  /** Absolute host paths are structurally forbidden from the artifact. */
  readonly absolutePathsIncluded: false;
  /** High-confidence detector count; content is preserved for reproducibility. */
  readonly obviousSecretsDetected: number;
}

export interface CapsuleWorkspaceV1 {
  readonly kind: typeof CAPSULE_WORKSPACE_KIND;
  readonly version: typeof CAPSULE_WORKSPACE_VERSION;
  readonly createdAt: string;
  readonly capsule: RunCapsuleV1;
  readonly files: readonly CapsuleWorkspaceFileV1[];
  readonly privacy: CapsuleWorkspacePrivacyV1;
}

export const CAPSULE_WORKSPACE_REJECT_REASONS = [
  'invalid-json',
  'unsupported-version',
  'invalid-shape',
  'invalid-capsule',
  'invalid-path',
  'duplicate-path',
  'too-many-files',
  'file-too-large',
  'files-too-large',
  'artifact-too-large',
] as const;

export type CapsuleWorkspaceRejectReason = (typeof CAPSULE_WORKSPACE_REJECT_REASONS)[number];

export type BuildCapsuleWorkspaceResult =
  | { readonly ok: true; readonly value: CapsuleWorkspaceV1; readonly json: string }
  | {
      readonly ok: false;
      readonly reason: CapsuleWorkspaceRejectReason;
      readonly detail?: string;
    };

export type ParseCapsuleWorkspaceResult =
  | { readonly ok: true; readonly value: CapsuleWorkspaceV1 }
  | {
      readonly ok: false;
      readonly reason: CapsuleWorkspaceRejectReason;
      readonly detail?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function countObviousSecrets(
  capsule: RunCapsuleV1,
  files: readonly CapsuleWorkspaceFileInput[]
): number {
  let count = redactSecretsFromCode(capsule.source.content).redactedCount;
  for (const file of files) {
    count += redactSecretsFromCode(file.content).redactedCount;
  }
  return count;
}

/**
 * Return a portable relative path, or null when a host path / traversal /
 * control character would leak into a shared artifact.
 */
export function normalizeCapsuleWorkspacePath(rawPath: string): string | null {
  if (typeof rawPath !== 'string') return null;
  const value = rawPath.trim();
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-z]:[\\/]/iu.test(value) ||
    value.includes('\\') ||
    containsControlCharacter(value) ||
    utf8ByteLength(value) > MAX_CAPSULE_WORKSPACE_PATH_BYTES
  ) {
    return null;
  }
  const parts = value.split('/');
  if (parts.some(part => part.length === 0 || part === '.' || part === '..')) {
    return null;
  }
  return parts.join('/');
}

function validateFileInputs(files: readonly CapsuleWorkspaceFileInput[]):
  | { readonly ok: true; readonly files: readonly CapsuleWorkspaceFileInput[] }
  | {
      readonly ok: false;
      readonly reason: CapsuleWorkspaceRejectReason;
      readonly detail?: string;
    } {
  if (files.length === 0 || files.length > MAX_CAPSULE_WORKSPACE_FILES) {
    return {
      ok: false,
      reason: 'too-many-files',
      detail: `files=${files.length}`,
    };
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const normalized: CapsuleWorkspaceFileInput[] = [];
  for (const file of files) {
    const path = normalizeCapsuleWorkspacePath(file.path);
    if (!path) {
      return { ok: false, reason: 'invalid-path', detail: String(file.path) };
    }
    if (!LANGUAGE_RE.test(file.language) || typeof file.content !== 'string') {
      return { ok: false, reason: 'invalid-shape', detail: path };
    }
    const portableKey = path.toLocaleLowerCase('en-US');
    if (seen.has(portableKey)) {
      return { ok: false, reason: 'duplicate-path', detail: path };
    }
    seen.add(portableKey);

    const bytes = utf8ByteLength(file.content);
    if (bytes > MAX_CAPSULE_WORKSPACE_FILE_BYTES) {
      return { ok: false, reason: 'file-too-large', detail: path };
    }
    totalBytes += bytes;
    if (totalBytes > MAX_CAPSULE_WORKSPACE_TOTAL_FILE_BYTES) {
      return {
        ok: false,
        reason: 'files-too-large',
        detail: `bytes=${totalBytes}`,
      };
    }
    normalized.push({ path, language: file.language, content: file.content });
  }
  return { ok: true, files: normalized };
}

export async function buildCapsuleWorkspace(
  capsule: RunCapsuleV1,
  files: readonly CapsuleWorkspaceFileInput[],
  createdAtMs = Date.now()
): Promise<BuildCapsuleWorkspaceResult> {
  if (!Array.isArray(files)) {
    return { ok: false, reason: 'invalid-shape', detail: 'files' };
  }
  const validated = validateFileInputs(files);
  if (!validated.ok) return validated;
  if (!Number.isFinite(createdAtMs)) {
    return { ok: false, reason: 'invalid-shape', detail: 'createdAt' };
  }

  let capsuleJson: string;
  try {
    capsuleJson = JSON.stringify(capsule);
  } catch {
    return { ok: false, reason: 'invalid-capsule', detail: 'not serializable' };
  }
  const inputCapsuleValidation = parseRunCapsule(capsuleJson);
  if (!inputCapsuleValidation.ok) {
    return {
      ok: false,
      reason: 'invalid-capsule',
      detail: inputCapsuleValidation.reason,
    };
  }

  const sanitisedCapsule = sanitizeRunCapsule(inputCapsuleValidation.value);
  const capsuleValidation = parseRunCapsule(JSON.stringify(sanitisedCapsule));
  if (!capsuleValidation.ok) {
    return {
      ok: false,
      reason: 'invalid-capsule',
      detail: capsuleValidation.reason,
    };
  }

  const workspaceFiles: CapsuleWorkspaceFileV1[] = [];
  for (const file of validated.files) {
    workspaceFiles.push({
      ...file,
      contentHash: await computeContentHash(file.content),
    });
  }

  const value: CapsuleWorkspaceV1 = {
    kind: CAPSULE_WORKSPACE_KIND,
    version: CAPSULE_WORKSPACE_VERSION,
    createdAt: new Date(createdAtMs).toISOString(),
    capsule: capsuleValidation.value,
    files: workspaceFiles,
    privacy: {
      sourceReview: 'explicit',
      absolutePathsIncluded: false,
      obviousSecretsDetected: countObviousSecrets(capsuleValidation.value, validated.files),
    },
  };
  const json = JSON.stringify(value, null, 2);
  if (utf8ByteLength(json) > MAX_CAPSULE_WORKSPACE_BYTES) {
    return { ok: false, reason: 'artifact-too-large' };
  }
  return { ok: true, value, json };
}

export function parseCapsuleWorkspace(json: string): ParseCapsuleWorkspaceResult {
  if (typeof json !== 'string' || json.length === 0) {
    return { ok: false, reason: 'invalid-json', detail: 'empty input' };
  }
  if (utf8ByteLength(json) > MAX_CAPSULE_WORKSPACE_BYTES) {
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
  if (!isRecord(raw)) return { ok: false, reason: 'invalid-shape' };
  if (raw.kind !== CAPSULE_WORKSPACE_KIND) {
    return { ok: false, reason: 'invalid-shape', detail: 'kind' };
  }
  if (raw.version !== CAPSULE_WORKSPACE_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-version',
      detail: `version=${String(raw.version)}`,
    };
  }
  if (
    typeof raw.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.createdAt)) ||
    !isRecord(raw.privacy)
  ) {
    return { ok: false, reason: 'invalid-shape', detail: 'metadata' };
  }
  const privacy = raw.privacy;
  if (
    privacy.sourceReview !== 'explicit' ||
    privacy.absolutePathsIncluded !== false ||
    typeof privacy.obviousSecretsDetected !== 'number' ||
    !Number.isInteger(privacy.obviousSecretsDetected) ||
    privacy.obviousSecretsDetected < 0
  ) {
    return { ok: false, reason: 'invalid-shape', detail: 'privacy' };
  }
  if (!isRecord(raw.capsule)) {
    return { ok: false, reason: 'invalid-capsule', detail: 'capsule' };
  }
  const capsuleJson = JSON.stringify(raw.capsule);
  if (utf8ByteLength(capsuleJson) > MAX_CAPSULE_BYTES) {
    return { ok: false, reason: 'invalid-capsule', detail: 'oversized' };
  }
  const parsedCapsule = parseRunCapsule(capsuleJson);
  if (!parsedCapsule.ok) {
    return {
      ok: false,
      reason: 'invalid-capsule',
      detail: parsedCapsule.reason,
    };
  }
  if (!Array.isArray(raw.files)) {
    return { ok: false, reason: 'invalid-shape', detail: 'files' };
  }
  const inputs: CapsuleWorkspaceFileInput[] = [];
  const hashes: string[] = [];
  for (const file of raw.files) {
    if (
      !isRecord(file) ||
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
  const validated = validateFileInputs(inputs);
  if (!validated.ok) return validated;

  const files = validated.files.map((file, index) => ({
    ...file,
    contentHash: hashes[index]!,
  }));
  const obviousSecretsDetected = countObviousSecrets(parsedCapsule.value, files);
  return {
    ok: true,
    value: {
      kind: CAPSULE_WORKSPACE_KIND,
      version: CAPSULE_WORKSPACE_VERSION,
      createdAt: raw.createdAt,
      capsule: parsedCapsule.value,
      files,
      privacy: {
        sourceReview: 'explicit',
        absolutePathsIncluded: false,
        obviousSecretsDetected,
      },
    },
  };
}

export function isCapsuleWorkspaceJson(source: string): boolean {
  try {
    const raw: unknown = JSON.parse(source);
    return isRecord(raw) && raw.kind === CAPSULE_WORKSPACE_KIND;
  } catch {
    return false;
  }
}

export function capsuleWorkspaceFilename(workspace: CapsuleWorkspaceV1): string {
  const day = workspace.createdAt.slice(0, 10);
  const id = workspace.capsule.capsuleId.replace(/[^a-z0-9]/giu, '').slice(0, 8);
  return `lingua-capsule-workspace-${day}-${id}.json`;
}
