/**
 * UUID v4/v7 and ULID generation + decoding helpers.
 *
 * Originally implementation (renderer-side); moved into the shared
 * utility layer under implementation (implementation note) so the pipeline `uuid`
 * adapter and the renderer's UUID panel consume one implementation —
 * the renderer's `src/renderer/utils/uuid.ts` is now a re-export shim,
 * so the v7/ULID bit-packing can no longer drift between two copies.
 *
 * UUID v7 and ULID both pack a 48-bit millisecond-precision unix
 * timestamp at the start, which is what makes them naturally sortable and
 * what the decoder surfaces. The rest is random bytes. All randomness
 * comes from Web Crypto (`crypto.getRandomValues` / `crypto.randomUUID`),
 * available in Electron's renderer, every supported browser, the CLI's
 * Node bundle, and the jsdom test environment — so no polyfill and no
 * IPC, keeping the helpers offline-safe.
 */

import type { AdapterRunOutcome, UtilityAdapter, UtilityOptionField } from './types';

export type IdentifierKind = 'uuid-v4' | 'uuid-v7' | 'ulid';

export interface DecodedIdentifier {
  kind: IdentifierKind;
  /** Unix ms timestamp if the format embeds one; undefined for UUID v4. */
  timestamp?: Date;
}

function randomBytes(count: number): Uint8Array {
  const buffer = new Uint8Array(count);
  crypto.getRandomValues(buffer);
  return buffer;
}

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/** Generate a random RFC 4122 UUID v4 via Web Crypto. */
export function generateUuidV4(): string {
  return crypto.randomUUID();
}

/**
 * Generate a UUID v7 per RFC 9562 draft:
 *   - 48 bits: unix_ts_ms (big-endian)
 *   - 4 bits: version (0b0111)
 *   - 12 bits: rand_a
 *   - 2 bits: variant (0b10)
 *   - 62 bits: rand_b
 *
 * The timestamp field is the single most useful property — `Date.now()` is
 * monotonic enough for the granularity we care about, and we do NOT try to
 * implement sub-ms monotonic counters in this change (that's RFC 9562's
 * "Method 1" and only matters under high-throughput batch generation).
 */
export function generateUuidV7(now: Date = new Date()): string {
  const ms = BigInt(now.getTime());
  const bytes = new Uint8Array(16);
  // 48-bit big-endian timestamp into bytes[0..5].
  for (let i = 0; i < 6; i += 1) {
    bytes[5 - i] = Number((ms >> BigInt(8 * i)) & 0xffn);
  }
  const random = randomBytes(10);
  for (let i = 0; i < 10; i += 1) {
    bytes[6 + i] = random[i] ?? 0;
  }
  // Set version (0111) in the high nibble of bytes[6].
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // Set variant (10xx) in the high two bits of bytes[8].
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, toHex).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decodeUuidV7(raw: string): DecodedIdentifier | null {
  const trimmed = raw.trim();
  if (!UUID_V7_REGEX.test(trimmed)) return null;
  const hex = trimmed.replaceAll('-', '').slice(0, 12);
  const ms = Number.parseInt(hex, 16);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return { kind: 'uuid-v7', timestamp: new Date(ms) };
}

// Crockford Base32 alphabet per the ULID spec.
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_INDEX = new Map<string, number>(
  Array.from(CROCKFORD_ALPHABET).map((char, index) => [char, index])
);

function encodeCrockford(value: bigint, length: number): string {
  const chars: string[] = [];
  let remaining = value;
  const base = 32n;
  for (let i = 0; i < length; i += 1) {
    const digit = Number(remaining % base);
    const char = CROCKFORD_ALPHABET[digit];
    if (!char) {
      throw new Error(`Crockford digit ${digit} is out of range`);
    }
    chars.unshift(char);
    remaining /= base;
  }
  return chars.join('');
}

function decodeCrockford(input: string): bigint | null {
  let total = 0n;
  for (const char of input) {
    const digit = CROCKFORD_INDEX.get(char.toUpperCase());
    if (digit === undefined) return null;
    total = total * 32n + BigInt(digit);
  }
  return total;
}

const ULID_LENGTH = 26;
const ULID_TIMESTAMP_LENGTH = 10;
const ULID_RANDOM_LENGTH = 16;

/**
 * Generate a ULID: 10 timestamp chars + 16 random chars, Crockford Base32.
 * Produces 26 uppercase alphanumeric characters. The spec forbids `I L O U`
 * (ambiguous), which Crockford already excludes.
 */
export function generateUlid(now: Date = new Date()): string {
  const ms = BigInt(now.getTime());
  const timestamp = encodeCrockford(ms, ULID_TIMESTAMP_LENGTH);

  const bytes = randomBytes(10); // 80 bits → 16 Crockford chars
  let randomValue = 0n;
  for (const byte of bytes) {
    randomValue = (randomValue << 8n) | BigInt(byte);
  }
  const random = encodeCrockford(randomValue, ULID_RANDOM_LENGTH);
  return timestamp + random;
}

export function decodeUlid(raw: string): DecodedIdentifier | null {
  const trimmed = raw.trim();
  if (trimmed.length !== ULID_LENGTH) return null;
  const head = trimmed.slice(0, ULID_TIMESTAMP_LENGTH);
  const tail = trimmed.slice(ULID_TIMESTAMP_LENGTH);
  const msBig = decodeCrockford(head);
  if (msBig === null) return null;
  if (decodeCrockford(tail) === null) return null;
  // ULID spec caps the timestamp at 2^48 - 1 which is 10889 AD, comfortably
  // inside Date's range; Number can represent it losslessly.
  return { kind: 'ulid', timestamp: new Date(Number(msBig)) };
}

/**
 * Dispatch a raw string to the best-matching decoder. The order is:
 *   1) UUID v7 (has the version nibble, so we can check exactly)
 *   2) UUID v4 (version nibble = 4; no timestamp to surface)
 *   3) ULID (length-based fallback)
 * Unknown strings return `null`.
 */
export function inspectIdentifier(raw: string): DecodedIdentifier | null {
  const asV7 = decodeUuidV7(raw);
  if (asV7) return asV7;
  if (UUID_V4_REGEX.test(raw.trim())) {
    return { kind: 'uuid-v4' };
  }
  const asUlid = decodeUlid(raw);
  if (asUlid) return asUlid;
  return null;
}

// ---------------------------------------------------------------------------
// implementation — `uuid` pipeline adapter (generator).
// ---------------------------------------------------------------------------

/** Output formats surfaced as the `format` option. */
export const UUID_ADAPTER_FORMATS = ['v4', 'v7', 'ulid'] as const;
export type UuidAdapterFormat = (typeof UUID_ADAPTER_FORMATS)[number];

/** Default + ceiling for how many identifiers a single run emits. */
export const UUID_ADAPTER_DEFAULT_COUNT = 3;
export const UUID_ADAPTER_MAX_COUNT = 100;

/**
 * Structured options for the `uuid` adapter. `count` is a string because
 * the schema-driven options form renders it as a `text` field (the field
 * vocabulary has no numeric type); `run` clamps it to
 * `[0, UUID_ADAPTER_MAX_COUNT]`. `hyphens` (implementation note) strips the dashes from
 * v4 / v7 output for systems that reject them; it is a no-op for ULID,
 * which has none.
 */
export interface UuidAdapterOptions {
  readonly format: UuidAdapterFormat;
  readonly count: string;
  readonly hyphens: boolean;
}

const UUID_FORMAT_SET: ReadonlySet<string> = new Set(UUID_ADAPTER_FORMATS);

const FORMAT_OPTION: UtilityOptionField = {
  key: 'format',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.uuid.options.format.label',
  defaultValue: 'v4',
  options: UUID_ADAPTER_FORMATS.map((value) => ({
    value,
    labelKey: `utilityPipeline.adapter.uuid.options.format.${value}`,
  })),
};

const COUNT_OPTION: UtilityOptionField = {
  key: 'count',
  type: 'text',
  labelKey: 'utilityPipeline.adapter.uuid.options.count.label',
  defaultValue: String(UUID_ADAPTER_DEFAULT_COUNT),
};

const HYPHENS_OPTION: UtilityOptionField = {
  key: 'hyphens',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.uuid.options.hyphens.label',
  defaultValue: true,
};

/** Clamp a free-text count to `[0, UUID_ADAPTER_MAX_COUNT]`; 0 → empty output. */
function clampCount(raw: string): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(Math.floor(numeric), UUID_ADAPTER_MAX_COUNT);
}

function generateIdentifier(format: UuidAdapterFormat): string {
  if (format === 'v7') return generateUuidV7();
  if (format === 'ulid') return generateUlid();
  return generateUuidV4();
}

export const uuidAdapter: UtilityAdapter<UuidAdapterOptions> = {
  id: 'uuid',
  titleKey: 'utilityPipeline.adapter.uuid.title',
  descriptionKey: 'utilityPipeline.adapter.uuid.description',
  // A generator: it ignores the chained input and emits fresh ids. It
  // still declares `text` kinds so it composes anywhere in a pipeline
  // (the upstream value is discarded by design — generators are source
  // steps). Non-deterministic by nature; tests assert shape, not value.
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [FORMAT_OPTION, COUNT_OPTION, HYPHENS_OPTION],
  defaultOptions: () => ({
    format: 'v4',
    count: String(UUID_ADAPTER_DEFAULT_COUNT),
    hyphens: true,
  }),
  parseOptions: (raw): UuidAdapterOptions | null => {
    if (raw === undefined || raw === null) {
      return { format: 'v4', count: String(UUID_ADAPTER_DEFAULT_COUNT), hyphens: true };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as { format?: unknown; count?: unknown; hyphens?: unknown };
    const format = candidate.format === undefined ? 'v4' : candidate.format;
    if (typeof format !== 'string' || !UUID_FORMAT_SET.has(format)) return null;
    const count =
      candidate.count === undefined ? String(UUID_ADAPTER_DEFAULT_COUNT) : candidate.count;
    if (typeof count !== 'string') return null;
    const hyphens = candidate.hyphens === undefined ? true : candidate.hyphens;
    if (typeof hyphens !== 'boolean') return null;
    return { format: format as UuidAdapterFormat, count, hyphens };
  },
  run: async (_input, options): Promise<AdapterRunOutcome<string>> => {
    const count = clampCount(options.count);
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = generateIdentifier(options.format);
      ids.push(options.hyphens ? id : id.replaceAll('-', ''));
    }
    return { ok: true, value: ids.join('\n') };
  },
};
