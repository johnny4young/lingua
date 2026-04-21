/**
 * UUID v7 and ULID generation + decoding helpers (RL-071 slice 1).
 *
 * Both formats pack a 48-bit millisecond-precision unix timestamp at the
 * start, which is what makes them naturally sortable and what the decoder
 * surfaces. The rest is random bytes. All randomness comes from Web Crypto
 * (`crypto.getRandomValues`), which is available in Electron's renderer,
 * every supported browser, and the jsdom test environment — so no polyfill
 * and no IPC, keeping the helpers offline-safe.
 */

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
 * implement sub-ms monotonic counters in this slice (that's RFC 9562's
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
