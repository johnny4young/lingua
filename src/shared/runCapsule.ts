/**
 * implementation — Run Capsules.
 *
 * `RunCapsuleV1` is the versioned, sanitised, JSON-serialisable record
 * of one Lingua execution: "I ran this code with this input, in this
 * environment, and got this output". The schema is the wire format
 * every downstream integration consumes:
 *
 *   - internal share-links serialise a capsule as the URL fragment.
 *   - internal CLI replays a capsule outside the GUI.
 *   - implementation attaches a capsule to AI prompt previews.
 *   - internal records HTTP responses as capsules.
 *   - internal pipelines emit one capsule per step.
 *   - implementation references a known-good capsule as the expected
 *     output reference for a lesson.
 *   - internal importers produce capsules from external formats.
 *
 * Shipping the schema first means each downstream integration inherits the
 * same redaction registry (`src/shared/redaction.ts`), the same
 * version-migration discipline (`version: 1` literal, future
 * versions hard-rejected by `parseRunCapsule`), and the same
 * round-trip contract.
 *
 * implementation ships the schema + builder + sanitiser + parser + a single
 * consumer (Settings → Account "Export latest run"). Import preview,
 * list view, and auto-capsule belong to future work. See the
 * internal scope for the full sequence and
 * `docs/CAPSULE_TEST_MATRIX.md` for the test matrix.
 */

import { REDACTION_VERSION, redactFlatRecord } from './redaction';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Status enum mirrored from `ExecutionResult.kind` so the capsule
 * tells the consumer the run outcome without re-parsing the error
 * string. The four-state enum widens the legacy `'ok' | 'error'`
 * to include `'timeout'` (parent-killed) and `'stopped'` (user-Stop)
 * per implementation
 */
export type RunCapsuleStatus = 'success' | 'error' | 'timeout' | 'stopped';

export interface RunCapsuleTab {
  /** Tab display name. Pre-sanitised; never an absolute path. */
  name: string;
  /** Language pack id (`'javascript'`, `'python'`, …). */
  language: string;
  /** Runtime mode (`'worker'` / `'node'` / `'browser-preview'`). */
  runtimeMode: string;
  /** Workflow mode (`'run'` / `'debug'` / `'scratchpad'`). */
  workflowMode: string;
}

export interface RunCapsuleSource {
  /** The code the runner actually executed. May be empty. */
  content: string;
  /** Hex SHA-256 of `content`. Hash on the entire string. */
  contentHash: string;
}

export interface RunCapsuleResult {
  status: RunCapsuleStatus;
  durationMs: number;
  /** Truncated to `MAX_STREAM_BYTES` if oversized; omittedFields flag set. */
  stdout?: string;
  stderr?: string;
  /** Per-line magic-comment results. Opaque to the schema. */
  lineResults?: unknown[];
  /** Rich payloads (chart / image / html / table). Opaque; downstream validates. */
  richOutputs?: unknown[];
  /** Diagnostics array (LSP / linter). Opaque; downstream validates. */
  diagnostics?: unknown[];
  /** Present only when status !== 'success'. */
  errorMessage?: string;
}

export interface RunCapsuleEnvironment {
  platform: 'web' | 'desktop';
  /** Runner id (e.g. `'python'`, `'node:22.4.0'`). */
  runner: string;
  /** Optional dependency summary opaque to the schema. */
  dependencySummary?: unknown;
  /**
   * implementation note — pre-run branch snapshot. Captured at
   * `executeTabManually.record()` START so a mid-run sibling-terminal
   * `git checkout` does NOT pollute the capsule with the post-checkout
   * branch. Absent on web builds (no git layer), in detached-HEAD
   * states, or when the gitStore posture is unavailable. Branch /
   * commit are passively-observed identifiers; they never leak working
   * tree content (the redactor never sees them).
   */
  git?: {
    branch?: string;
    commit?: string;
  };
}

export interface RunCapsulePrivacy {
  /** Stamp from `REDACTION_VERSION` so the consumer knows the rule set. */
  redactionVersion: string;
  /** Field paths that were dropped or truncated. May be empty. */
  omittedFields: string[];
}

export interface RunCapsuleInput {
  /** Optional pre-set stdin buffer . May be empty. */
  stdin?: string;
  /** internal — optional name of the saved input set used for this run. */
  setName?: string;
  /** internal — optional argv snapshot, one array item per argument. */
  args?: string[];
}

export interface RunCapsuleV1 {
  /** Hard-coded `1`. `parseRunCapsule` rejects any other value. */
  version: 1;
  /** UUIDv4 from `crypto.randomUUID()`. */
  capsuleId: string;
  /** ISO timestamp (millisecond precision). */
  createdAt: string;
  /** Build version stamp from `appInfo`. */
  appVersion: string;
  tab: RunCapsuleTab;
  source: RunCapsuleSource;
  input: RunCapsuleInput;
  result: RunCapsuleResult;
  environment: RunCapsuleEnvironment;
  privacy: RunCapsulePrivacy;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/** Hard cap per stdout / stderr stream. 1 MiB each, total 2 MiB. */
export const MAX_STREAM_BYTES = 1_048_576;

/** Hard cap on the whole serialised capsule JSON. 4 MiB. */
export const MAX_CAPSULE_BYTES = 4_194_304;

export type CapsuleSizeBucket = '<10kb' | '<100kb' | '<1mb' | '<4mb' | '>=4mb';

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Telemetry size buckets. Closed enum mirrored in
 * `src/shared/telemetry.ts` + `update-server/src/telemetry.ts`. Drives
 * the `capsule.exported.sizeBucket` allowlist.
 */
export function bucketCapsuleSize(bytes: number): CapsuleSizeBucket {
  if (bytes < 10_240) return '<10kb';
  if (bytes < 102_400) return '<100kb';
  if (bytes < 1_048_576) return '<1mb';
  if (bytes < 4_194_304) return '<4mb';
  return '>=4mb';
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (utf8ByteLength(value.slice(0, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  let truncated = value.slice(0, low);
  const last = truncated.charCodeAt(truncated.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Pure constructor for `RunCapsuleV1`. Awaits `contentHash` via the
 * async helper because Web Crypto's `subtle.digest` is async.
 *
 * The caller is responsible for passing values already coerced to the
 * right shape — this function does not validate language tokens or
 * runtime modes beyond storing what it received. The sanitiser handles
 * redaction; the parser handles consumer-side validation.
 */
export interface BuildRunCapsuleInput {
  appVersion: string;
  tab: RunCapsuleTab;
  source: { content: string };
  input?: RunCapsuleInput;
  result: RunCapsuleResult;
  environment: RunCapsuleEnvironment;
  /** Override for tests — production passes nothing and the helper uses Date.now. */
  createdAtMs?: number;
  /** Override for tests — production passes nothing and crypto.randomUUID runs. */
  capsuleId?: string;
}

export async function buildRunCapsule(
  inputArgs: BuildRunCapsuleInput
): Promise<RunCapsuleV1> {
  const contentHash = await computeContentHash(inputArgs.source.content);
  const capsuleId = inputArgs.capsuleId ?? crypto.randomUUID();
  const createdAt = new Date(inputArgs.createdAtMs ?? Date.now()).toISOString();

  return {
    version: 1,
    capsuleId,
    createdAt,
    appVersion: inputArgs.appVersion,
    tab: inputArgs.tab,
    source: {
      content: inputArgs.source.content,
      contentHash,
    },
    input: inputArgs.input ?? {},
    result: inputArgs.result,
    environment: inputArgs.environment,
    privacy: {
      redactionVersion: REDACTION_VERSION,
      omittedFields: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Sanitiser
// ---------------------------------------------------------------------------

/**
 * Walks the capsule, redacts anything sensitive, truncates oversized
 * streams, and reports what was dropped in `privacy.omittedFields`.
 *
 * Redaction rules (rev `REDACTION_VERSION`):
 *
 *   - Walk top-level keys of `result.*` and any *flat* dependency
 *     summary fields; drop entries whose key matches DENY_SUBSTRINGS
 *     or whose value is non-primitive (per `valueLooksSensitive`).
 *   - Truncate `result.stdout` + `result.stderr` to MAX_STREAM_BYTES.
 *   - NEVER touches `source.content` — capsules are explicitly
 *     allowed to carry the source the user ran (that IS the whole
 *     point of a replay artifact). The Privacy + Trust Dashboard
 * surfaces this clearly; here we just record the
 *     decision in `omittedFields` when the stream was clamped so
 *     downstream tooling can flag the partial capsule.
 *
 * Returns a NEW capsule object — never mutates the input.
 */
export function sanitizeRunCapsule(capsule: RunCapsuleV1): RunCapsuleV1 {
  const omittedFields: string[] = [];

  let stdout = capsule.result.stdout;
  if (typeof stdout === 'string' && utf8ByteLength(stdout) > MAX_STREAM_BYTES) {
    stdout = truncateUtf8(stdout, MAX_STREAM_BYTES);
    omittedFields.push('result.stdout');
  }

  let stderr = capsule.result.stderr;
  if (typeof stderr === 'string' && utf8ByteLength(stderr) > MAX_STREAM_BYTES) {
    stderr = truncateUtf8(stderr, MAX_STREAM_BYTES);
    omittedFields.push('result.stderr');
  }

  // implementation — dependencySummary is opaque-to-the-schema but
  // when it is a flat object we delegate to `redactFlatRecord` so
  // any future rule change in `shared/redaction.ts` propagates here
  // automatically (the reviewer-driven extraction guards against
  // sanitiser drift). Anything richer (nested arrays, arrays of
  // objects, primitives at the top level) is dropped wholesale and
  // the field name surfaces in `omittedFields`.
  let dependencySummary = capsule.environment.dependencySummary;
  if (dependencySummary !== undefined && dependencySummary !== null) {
    if (
      typeof dependencySummary === 'object' &&
      !Array.isArray(dependencySummary)
    ) {
      const { surviving, dropped } = redactFlatRecord(
        dependencySummary as Record<string, unknown>
      );
      dependencySummary = surviving;
      if (dropped.length > 0) {
        omittedFields.push('environment.dependencySummary');
      }
    } else {
      // Non-object shape — drop wholesale to honour the privacy
      // contract; the consumer's diagnostics still survive elsewhere.
      dependencySummary = undefined;
      omittedFields.push('environment.dependencySummary');
    }
  }

  const sanitisedResult: RunCapsuleResult = {
    ...capsule.result,
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
  };

  return {
    ...capsule,
    result: sanitisedResult,
    environment: {
      ...capsule.environment,
      ...(dependencySummary !== undefined
        ? { dependencySummary }
        : { dependencySummary: undefined }),
    },
    privacy: {
      redactionVersion: capsule.privacy.redactionVersion,
      omittedFields: [
        ...new Set([...capsule.privacy.omittedFields, ...omittedFields]),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export type ParseRunCapsuleReason =
  | 'invalid-json'
  | 'unsupported-version'
  | 'oversized'
  | 'missing-required-field'
  | 'invalid-field-type';

export type ParseRunCapsuleResult =
  | { ok: true; value: RunCapsuleV1 }
  | { ok: false; reason: ParseRunCapsuleReason; detail?: string };

/**
 * Parses + validates a capsule JSON string. Defence in depth: even
 * when the source is a Lingua-emitted capsule we re-validate so an
 * adversarial fragment (internal share-link) cannot ship a forged
 * version: 2 or a bag of unknown fields and reach the renderer.
 */
export function parseRunCapsule(json: string): ParseRunCapsuleResult {
  if (typeof json !== 'string' || json.length === 0) {
    return { ok: false, reason: 'invalid-json', detail: 'empty input' };
  }
  const byteLength = utf8ByteLength(json);
  if (byteLength > MAX_CAPSULE_BYTES) {
    return { ok: false, reason: 'oversized', detail: `${byteLength}b` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid-json',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid-field-type', detail: 'root not object' };
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 1) {
    return {
      ok: false,
      reason: 'unsupported-version',
      detail: `version=${String(candidate.version)}`,
    };
  }
  // Shallow required-field check. Downstream integrations that need
  // tighter assertions wrap this with their own schema validator
  // (cheaper than pulling Zod into shared).
  const required: Array<keyof RunCapsuleV1> = [
    'capsuleId',
    'createdAt',
    'appVersion',
    'tab',
    'source',
    'input',
    'result',
    'environment',
    'privacy',
  ];
  for (const key of required) {
    if (!(key in candidate)) {
      return {
        ok: false,
        reason: 'missing-required-field',
        detail: String(key),
      };
    }
  }
  // Minimal type-shape validation on the load-bearing nested fields.
  if (!isRecord(candidate.tab)) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'tab fields',
    };
  }
  const tab = candidate.tab;
  if (
    typeof tab.name !== 'string' ||
    typeof tab.language !== 'string' ||
    typeof tab.runtimeMode !== 'string' ||
    typeof tab.workflowMode !== 'string'
  ) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'tab fields',
    };
  }
  if (!isRecord(candidate.source)) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'source fields',
    };
  }
  const source = candidate.source;
  if (typeof source.content !== 'string' || typeof source.contentHash !== 'string') {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'source fields',
    };
  }
  if (!isRecord(candidate.result)) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'result.status / durationMs',
    };
  }
  const result = candidate.result;
  const validStatus =
    result.status === 'success' ||
    result.status === 'error' ||
    result.status === 'timeout' ||
    result.status === 'stopped';
  if (!validStatus || typeof result.durationMs !== 'number') {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'result.status / durationMs',
    };
  }
  if (
    (result.stdout !== undefined && typeof result.stdout !== 'string') ||
    (result.stderr !== undefined && typeof result.stderr !== 'string') ||
    (result.errorMessage !== undefined &&
      typeof result.errorMessage !== 'string') ||
    (result.lineResults !== undefined && !Array.isArray(result.lineResults)) ||
    (result.richOutputs !== undefined && !Array.isArray(result.richOutputs)) ||
    (result.diagnostics !== undefined && !Array.isArray(result.diagnostics))
  ) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'result optional fields',
    };
  }
  if (!isRecord(candidate.environment)) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'environment fields',
    };
  }
  const environment = candidate.environment;
  if (
    (environment.platform !== 'web' && environment.platform !== 'desktop') ||
    typeof environment.runner !== 'string'
  ) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'environment fields',
    };
  }
  if (!isRecord(candidate.input)) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'input fields',
    };
  }
  const input = candidate.input;
  if (input.stdin !== undefined && typeof input.stdin !== 'string') {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'input fields',
    };
  }
  if (
    (input.setName !== undefined && typeof input.setName !== 'string') ||
    (input.args !== undefined &&
      (!Array.isArray(input.args) ||
        input.args.some((arg) => typeof arg !== 'string')))
  ) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'input fields',
    };
  }
  if (!isRecord(candidate.privacy)) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'privacy fields',
    };
  }
  const privacy = candidate.privacy;
  if (
    typeof privacy.redactionVersion !== 'string' ||
    !Array.isArray(privacy.omittedFields)
  ) {
    return {
      ok: false,
      reason: 'invalid-field-type',
      detail: 'privacy fields',
    };
  }
  return { ok: true, value: candidate as unknown as RunCapsuleV1 };
}

// ---------------------------------------------------------------------------
// Summary helper
// ---------------------------------------------------------------------------

/**
 * One-line capsule summary suitable for Settings rows.
 * Example: `"javascript · success · 12ms · 2026-05-21T13:00:00.000Z"`.
 *
 * Pure formatter; renderer-side i18n is applied by the consuming
 * component, not here.
 */
export function summarizeRunCapsule(capsule: RunCapsuleV1): string {
  const ms = Math.max(0, Math.round(capsule.result.durationMs));
  return `${capsule.tab.language} · ${capsule.result.status} · ${ms}ms · ${capsule.createdAt}`;
}

// ---------------------------------------------------------------------------
// Content hash helper
// ---------------------------------------------------------------------------

/**
 * Hex SHA-256 of the input. Uses Web Crypto's `subtle.digest` which
 * is available in the renderer thread, web workers, AND Node ≥ 19.
 * Tests patch `globalThis.crypto.subtle` if a specific environment
 * lacks it.
 *
 * Caller-context guarantees:
 *
 *   - **Renderer thread** (executeTabManually) — `window.crypto.subtle`
 *     is always present in Lingua's Electron target.
 *   - **Web Workers** — `crypto.subtle` is present in Workers since
 *     Chromium 95; safe for Lingua's pinned Electron.
 *   - **Node (CLI / tests / future internal)** — present since Node 19.
 *     Older Node would need a polyfill before calling.
 *
 * Throw path: reachable only in environments without Web Crypto
 * (e.g. an unsupported polyfill, an old Electron pre-Chromium 95).
 * Callers should treat the throw as terminal and fall back to a
 * capsule-less record (mirror of `tryBuildCapsule` in
 * `src/renderer/runtime/executeTabManually.ts`).
 *
 * Implementation detail: keep the helper exported so the test suite
 * can verify determinism + cross-input distinctness directly.
 */
export async function computeContentHash(content: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error(
      'computeContentHash: Web Crypto unavailable (no globalThis.crypto.subtle)'
    );
  }
  const bytes = new TextEncoder().encode(content);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
