/**
 * RL-036 Phase A1 — No-backend share-link payload schema.
 *
 * `SharePayloadV1` is the wire format for the
 * `#share=v1.<gzip-base64url>` URL fragment. Phase A1 is single-tab,
 * source-only (no run result, no contentHash) so the receiver can
 * reproduce the tab the sender had open AND choose to run it
 * themselves.
 *
 * Encoding pipeline (encoder):
 *   1. Validate payload shape (closed enums, language pack, size caps).
 *   2. `JSON.stringify` (minified — every byte counts in a URL fragment).
 *   3. UTF-8 encode to `Uint8Array`.
 *   4. gzip via the browser `CompressionStream` API.
 *   5. base64url encode (RFC 4648 §5: `[A-Za-z0-9_-]`, no padding).
 *
 * The reverse runs at decode. Every reject path is closed: tampered
 * base64, corrupt gzip, malformed JSON, unknown version, unknown
 * language, oversized post-decompress, missing required fields.
 *
 * `SharePayloadV1` NEVER contains:
 *   - `licenseToken` or any subset
 *   - `filePath` (absolute) or `rootId` / `relativePath`
 *   - environment variables (any scope)
 *   - device identifiers
 *   - project identity (`projectId`, root path)
 *   - run result (logs, errors, timing, contentHash)
 *
 * Pinned by `tests/shared/sharePayload.test.ts` with a
 * deliberately-constructed malicious fixture.
 */

import { getLanguagePackById } from './languagePacks';
import { RUNTIME_MODES, type RuntimeMode } from './runtimeModes';
import { WORKFLOW_MODES, type WorkflowMode } from './workflowMode';

export const SHARE_PAYLOAD_VERSION = 1 as const;

/**
 * The `#` prefix is added by the URL composer; this constant lives
 * between the `#` and the base64url payload. Bumping the version
 * here lets a future Phase A2 negotiate a different shape under a
 * different prefix without breaking Phase A1 readers.
 */
export const SHARE_FRAGMENT_PREFIX = 'share=v1.';

/**
 * Hard cap on the post-encode URL fragment length (in characters).
 * Browser URL length is technically larger but proxies, share
 * targets, SMS gateways, and Twitter clip aggressively around
 * ~6 KB. We reject pre-emptively so the user gets an honest "too
 * large" notice rather than a silently-truncated link.
 */
export const MAX_SHARE_FRAGMENT_BYTES = 6144;

/**
 * Pre-encode source content cap. Anything larger never produces a
 * usable fragment even after gzip, so reject before paying the
 * compression cost.
 */
export const MAX_SHARE_SOURCE_BYTES = 16384;

/**
 * Pre-encode stdin cap. Stdin is rare in shared snippets; keep it
 * small so it never dominates the fragment budget.
 */
export const MAX_SHARE_STDIN_BYTES = 4096;

/**
 * Cap on the decompressed payload byte length, mirroring the
 * gzip-bomb defence pattern in `parseRunCapsule` (RL-094).
 * Decompressed payloads larger than this are treated as adversarial.
 */
export const MAX_SHARE_DECOMPRESSED_BYTES = 64 * 1024; // 64 KiB

export interface SharePayloadV1 {
  readonly version: 1;
  readonly tab: {
    readonly name: string;
    readonly language: string;
  };
  readonly source: {
    readonly content: string;
  };
  readonly modes?: {
    readonly runtime?: RuntimeMode;
    readonly workflow?: WorkflowMode;
    readonly autoLog?: boolean;
  };
  readonly input?: {
    readonly stdin?: string;
  };
}

export interface BuildSharePayloadInput {
  readonly name: string;
  readonly language: string;
  readonly content: string;
  readonly runtimeMode?: string;
  readonly workflowMode?: string;
  readonly autoLogEnabled?: boolean;
  readonly stdinBuffer?: string;
}

export type ShareEncodeError =
  | 'unknown-language'
  | 'source-too-large'
  | 'fragment-too-large';

export type ShareEncodeResult =
  | { ok: true; fragment: string; sizeBytes: number }
  | { ok: false; reason: ShareEncodeError; sizeBytes: number };

export type ShareDecodeError =
  | 'invalid-prefix'
  | 'invalid-base64'
  | 'gzip-corrupt'
  | 'oversized'
  | 'json-malformed'
  | 'unknown-version'
  | 'shape-invalid'
  | 'unknown-language';

export type ShareDecodeResult =
  | { ok: true; payload: SharePayloadV1 }
  | { ok: false; reason: ShareDecodeError; detail?: string };

// ---------------------------------------------------------------------------
// Builder — pure, no side effects, no network. Drops unknown modes
// silently so the receiver's `editorStore.addTab()` can backfill with
// the language's defaults (defensive layering — Phase A1 never trusts
// the wire).
// ---------------------------------------------------------------------------

export function buildSharePayload(
  input: BuildSharePayloadInput
): SharePayloadV1 {
  const knownRuntime =
    typeof input.runtimeMode === 'string' &&
    RUNTIME_MODES.includes(input.runtimeMode as RuntimeMode)
      ? (input.runtimeMode as RuntimeMode)
      : undefined;
  const knownWorkflow =
    typeof input.workflowMode === 'string' &&
    WORKFLOW_MODES.includes(input.workflowMode as WorkflowMode)
      ? (input.workflowMode as WorkflowMode)
      : undefined;
  const knownAutoLog =
    typeof input.autoLogEnabled === 'boolean'
      ? input.autoLogEnabled
      : undefined;
  const modes: NonNullable<SharePayloadV1['modes']> = {
    ...(knownRuntime !== undefined ? { runtime: knownRuntime } : {}),
    ...(knownWorkflow !== undefined ? { workflow: knownWorkflow } : {}),
    ...(knownAutoLog !== undefined ? { autoLog: knownAutoLog } : {}),
  };
  const hasModes = Object.keys(modes).length > 0;

  const stdin =
    typeof input.stdinBuffer === 'string'
      ? truncateUtf8(input.stdinBuffer, MAX_SHARE_STDIN_BYTES)
      : undefined;

  const payload: SharePayloadV1 = {
    version: SHARE_PAYLOAD_VERSION,
    tab: {
      name: input.name,
      language: input.language,
    },
    source: {
      content: input.content,
    },
    ...(hasModes ? { modes } : {}),
    ...(stdin !== undefined && stdin.length > 0
      ? { input: { stdin } }
      : {}),
  };
  return payload;
}

// ---------------------------------------------------------------------------
// Encoder — async because `CompressionStream` is stream-based.
// Rejects closed: unknown-language (defensive — caller usually
// validates first), source-too-large (pre-encode), fragment-too-large
// (post-encode).
// ---------------------------------------------------------------------------

export async function encodeShareFragment(
  payload: SharePayloadV1,
  options: { maxFragmentBytes?: number } = {}
): Promise<ShareEncodeResult> {
  const fragmentCap =
    options.maxFragmentBytes ?? MAX_SHARE_FRAGMENT_BYTES;

  if (!getLanguagePackById(payload.tab.language)) {
    return {
      ok: false,
      reason: 'unknown-language',
      sizeBytes: 0,
    };
  }
  const sourceBytes = utf8ByteLength(payload.source.content);
  if (sourceBytes > MAX_SHARE_SOURCE_BYTES) {
    return {
      ok: false,
      reason: 'source-too-large',
      sizeBytes: sourceBytes,
    };
  }
  const json = JSON.stringify(payload);
  const gzipped = await gzipBytes(textEncoder().encode(json));
  const base64url = bytesToBase64Url(gzipped);
  const fragment = `${SHARE_FRAGMENT_PREFIX}${base64url}`;
  if (fragment.length > fragmentCap) {
    return {
      ok: false,
      reason: 'fragment-too-large',
      sizeBytes: fragment.length,
    };
  }
  return { ok: true, fragment, sizeBytes: fragment.length };
}

// ---------------------------------------------------------------------------
// Decoder — accepts either the raw fragment (with `share=v1.` prefix)
// OR the same fragment with a leading `#`. Every reject path is
// labelled so the caller can pick a localized notice.
// ---------------------------------------------------------------------------

export async function decodeShareFragment(
  rawFragment: string
): Promise<ShareDecodeResult> {
  const fragment = rawFragment.startsWith('#')
    ? rawFragment.slice(1)
    : rawFragment;
  if (!fragment.startsWith(SHARE_FRAGMENT_PREFIX)) {
    return { ok: false, reason: 'invalid-prefix' };
  }
  const body = fragment.slice(SHARE_FRAGMENT_PREFIX.length);
  if (body.length === 0) {
    return { ok: false, reason: 'invalid-base64' };
  }

  const gzipped = base64UrlToBytes(body);
  if (gzipped === null) {
    return { ok: false, reason: 'invalid-base64' };
  }

  let decompressed: Uint8Array;
  try {
    decompressed = await gunzipBytes(gzipped, MAX_SHARE_DECOMPRESSED_BYTES);
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message === SHARE_OVERSIZED_INTERNAL_SIGNAL
    ) {
      return { ok: false, reason: 'oversized' };
    }
    return { ok: false, reason: 'gzip-corrupt' };
  }

  let text: string;
  try {
    text = textDecoder().decode(decompressed);
  } catch {
    return { ok: false, reason: 'json-malformed' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json-malformed' };
  }

  if (!isObject(parsed)) {
    return { ok: false, reason: 'shape-invalid' };
  }

  const versionField = (parsed as { version?: unknown }).version;
  if (versionField !== SHARE_PAYLOAD_VERSION) {
    return {
      ok: false,
      reason: 'unknown-version',
      detail:
        typeof versionField === 'number' || typeof versionField === 'string'
          ? String(versionField)
          : undefined,
    };
  }

  const tab = (parsed as { tab?: unknown }).tab;
  const source = (parsed as { source?: unknown }).source;
  if (!isObject(tab) || !isObject(source)) {
    return { ok: false, reason: 'shape-invalid' };
  }
  const name = (tab as { name?: unknown }).name;
  const language = (tab as { language?: unknown }).language;
  const content = (source as { content?: unknown }).content;
  if (
    typeof name !== 'string' ||
    typeof language !== 'string' ||
    typeof content !== 'string'
  ) {
    return { ok: false, reason: 'shape-invalid' };
  }
  if (utf8ByteLength(content) > MAX_SHARE_SOURCE_BYTES) {
    return { ok: false, reason: 'oversized' };
  }
  if (!getLanguagePackById(language)) {
    return { ok: false, reason: 'unknown-language', detail: language };
  }

  const modesRaw = (parsed as { modes?: unknown }).modes;
  const inputRaw = (parsed as { input?: unknown }).input;

  let cleanedRuntime: RuntimeMode | undefined;
  let cleanedWorkflow: WorkflowMode | undefined;
  let cleanedAutoLog: boolean | undefined;
  if (isObject(modesRaw)) {
    const runtime = (modesRaw as { runtime?: unknown }).runtime;
    const workflow = (modesRaw as { workflow?: unknown }).workflow;
    const autoLog = (modesRaw as { autoLog?: unknown }).autoLog;
    if (
      typeof runtime === 'string' &&
      RUNTIME_MODES.includes(runtime as RuntimeMode)
    ) {
      cleanedRuntime = runtime as RuntimeMode;
    }
    if (
      typeof workflow === 'string' &&
      WORKFLOW_MODES.includes(workflow as WorkflowMode)
    ) {
      cleanedWorkflow = workflow as WorkflowMode;
    }
    if (typeof autoLog === 'boolean') {
      cleanedAutoLog = autoLog;
    }
  }
  const cleanedModes: NonNullable<SharePayloadV1['modes']> = {
    ...(cleanedRuntime !== undefined ? { runtime: cleanedRuntime } : {}),
    ...(cleanedWorkflow !== undefined ? { workflow: cleanedWorkflow } : {}),
    ...(cleanedAutoLog !== undefined ? { autoLog: cleanedAutoLog } : {}),
  };
  const hasModes = Object.keys(cleanedModes).length > 0;

  let cleanedInput: SharePayloadV1['input'];
  if (isObject(inputRaw)) {
    const stdin = (inputRaw as { stdin?: unknown }).stdin;
    if (typeof stdin === 'string' && stdin.length > 0) {
      cleanedInput = {
        stdin: truncateUtf8(stdin, MAX_SHARE_STDIN_BYTES),
      };
    }
  }

  const payload: SharePayloadV1 = {
    version: SHARE_PAYLOAD_VERSION,
    tab: { name, language },
    source: { content },
    ...(hasModes ? { modes: cleanedModes } : {}),
    ...(cleanedInput ? { input: cleanedInput } : {}),
  };
  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Telemetry size bucket — Fold G. Closed enum mirrored on
// update-server with parity test.
// ---------------------------------------------------------------------------

export const SHARE_SIZE_BUCKETS = [
  '<1kb',
  '<2kb',
  '<4kb',
  '<6kb',
  '>=6kb',
] as const;
export type ShareSizeBucket = (typeof SHARE_SIZE_BUCKETS)[number];

export function bucketShareSize(bytes: number): ShareSizeBucket {
  if (bytes < 1024) return '<1kb';
  if (bytes < 2048) return '<2kb';
  if (bytes < 4096) return '<4kb';
  if (bytes < 6144) return '<6kb';
  return '>=6kb';
}

// ---------------------------------------------------------------------------
// Helpers — TextEncoder / TextDecoder are constructor-cached so a
// hot tab share doesn't allocate per call. base64url is implemented
// inline (no npm dep) because the standard library's `btoa` does
// classic base64 with `+`/`/`/`=`; we map to `-`/`_`/strip padding.
// ---------------------------------------------------------------------------

const SHARE_OVERSIZED_INTERNAL_SIGNAL = 'lingua:share:oversized';

let _textEncoder: TextEncoder | null = null;
function textEncoder(): TextEncoder {
  if (_textEncoder === null) _textEncoder = new TextEncoder();
  return _textEncoder;
}
let _textDecoder: TextDecoder | null = null;
function textDecoder(): TextDecoder {
  if (_textDecoder === null) {
    _textDecoder = new TextDecoder('utf-8', { fatal: true });
  }
  return _textDecoder;
}

export function utf8ByteLength(s: string): number {
  return textEncoder().encode(s).byteLength;
}

/**
 * Truncate a UTF-8 string so the encoded byte length never exceeds
 * `capBytes`. Iterates by 1 character at a time from the end to
 * avoid splitting surrogate pairs (the same defensive pattern used
 * by `truncateUtf8` in `runCapsule.ts`).
 */
function truncateUtf8(s: string, capBytes: number): string {
  if (utf8ByteLength(s) <= capBytes) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const slice = s.slice(0, mid);
    if (utf8ByteLength(slice) <= capBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return s.slice(0, lo);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  // CompressionStream is a TransformStream; write input to `.writable`
  // and read the gzipped bytes off `.readable`. Start draining before
  // awaiting the writer: Chromium applies backpressure to
  // `writer.write()` until the readable side is consumed, so a
  // write-then-read sequence can hang the share flow in the browser.
  // Avoids `Blob.stream()` because jsdom does not implement it (Node
  // 18+ has the native Streams API but the Blob shim does not).
  // `Response` can drain any ReadableStream to an ArrayBuffer.
  //
  // TypeScript 6+ widens `Uint8Array` to `Uint8Array<ArrayBufferLike>`
  // which is not assignable to the writer's `BufferSource` (it
  // requires `ArrayBuffer` specifically, not `SharedArrayBuffer`).
  // The cast to `BufferSource` is safe because we control the input
  // — every call site builds the array from `TextEncoder`, which
  // returns a real `ArrayBuffer`-backed `Uint8Array`.
  const cs = new CompressionStream('gzip');
  const bufferPromise = new Response(cs.readable).arrayBuffer();
  const writer = cs.writable.getWriter();
  await writer.write(input as unknown as BufferSource);
  await writer.close();
  const buffer = await bufferPromise;
  return new Uint8Array(buffer);
}

async function gunzipBytes(
  input: Uint8Array,
  maxBytes: number
): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  // The write/close on the gunzip path can reject when the input is
  // a gzip-bomb — Node racing the decoder against our manual cancel
  // surfaces an ABORT_ERR. Swallow it: we already throw the
  // oversized signal from the read loop and propagate the real cause
  // to the caller. See gzipBytes for the BufferSource cast rationale.
  void writer.write(input as unknown as BufferSource).catch(() => {});
  void writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          // Fire-and-forget the cancel; awaiting it surfaces a
          // benign ABORT_ERR that masks the oversized signal we
          // actually want the decoder to propagate.
          void reader.cancel().catch(() => {});
          throw new Error(SHARE_OVERSIZED_INTERNAL_SIGNAL);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // releaseLock can throw if the reader is already cancelled;
      // it's a best-effort cleanup either way.
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // Build the classic-base64 string via a stringifier safe for large
  // inputs (`String.fromCharCode(...bytes)` blows the stack at ~64 KB
  // on V8). Then translate to base64url + drop padding.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : // Node fallback for tests
        Buffer.from(binary, 'binary').toString('base64');
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function base64UrlToBytes(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(input)) {
    return null;
  }
  const padding = (4 - (input.length % 4)) % 4;
  const base64 =
    input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding);
  try {
    const binary =
      typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('binary');
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}
