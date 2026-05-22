/**
 * RL-036 Phase A1 — `SharePayloadV1` round-trip + reject path matrix.
 *
 * Pinning the wire format end-to-end (build → encode → decode →
 * matches), every reject path, the URL-safe alphabet contract, the
 * size budget guardrails, the gzip-bomb defence, and the privacy
 * invariant that a maliciously-constructed `FileTab` cannot leak
 * `licenseToken` / `filePath` / `rootId` / env vars into the
 * payload.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_SHARE_DECOMPRESSED_BYTES,
  MAX_SHARE_FRAGMENT_BYTES,
  MAX_SHARE_SOURCE_BYTES,
  MAX_SHARE_STDIN_BYTES,
  SHARE_FRAGMENT_PREFIX,
  SHARE_PAYLOAD_VERSION,
  SHARE_SIZE_BUCKETS,
  bucketShareSize,
  buildSharePayload,
  decodeShareFragment,
  encodeShareFragment,
  utf8ByteLength,
  type SharePayloadV1,
} from '../../src/shared/sharePayload';

const happyPayload: SharePayloadV1 = buildSharePayload({
  name: 'demo.js',
  language: 'javascript',
  content: 'console.log("hello, share");',
  runtimeMode: 'worker',
  workflowMode: 'scratchpad',
  autoLogEnabled: true,
});

describe('SharePayloadV1 — builder', () => {
  it('serialises the safe-field subset only', () => {
    expect(happyPayload).toEqual({
      version: 1,
      tab: { name: 'demo.js', language: 'javascript' },
      source: { content: 'console.log("hello, share");' },
      modes: { runtime: 'worker', workflow: 'scratchpad', autoLog: true },
    });
  });

  it('drops unknown runtime / workflow modes silently', () => {
    const payload = buildSharePayload({
      name: 'x.go',
      language: 'go',
      content: 'package main',
      runtimeMode: 'nonexistent-mode',
      workflowMode: 'also-nonexistent',
    });
    expect(payload.modes).toBeUndefined();
  });

  it('omits the modes block when no mode field is set', () => {
    const payload = buildSharePayload({
      name: 'x.py',
      language: 'python',
      content: 'print(1)',
    });
    expect(payload).toEqual({
      version: 1,
      tab: { name: 'x.py', language: 'python' },
      source: { content: 'print(1)' },
    });
  });

  it('truncates over-cap stdin without splitting UTF-8 boundaries', () => {
    // Each emoji ≈ 4 UTF-8 bytes. Emit enough to overshoot MAX_SHARE_STDIN_BYTES.
    const emoji = '🚀';
    const overshoot = emoji.repeat(Math.ceil(MAX_SHARE_STDIN_BYTES / 4) + 50);
    const payload = buildSharePayload({
      name: 'a.js',
      language: 'javascript',
      content: 'x',
      stdinBuffer: overshoot,
    });
    expect(payload.input?.stdin).toBeDefined();
    expect(utf8ByteLength(payload.input!.stdin!)).toBeLessThanOrEqual(
      MAX_SHARE_STDIN_BYTES
    );
    // The truncated stdin must still be valid UTF-8 (emoji count is integral).
    const charLength = payload.input!.stdin!.length;
    expect(charLength % 2).toBe(0); // Each emoji takes 2 UTF-16 code units.
  });

  it('omits the input block when stdin is empty', () => {
    const payload = buildSharePayload({
      name: 'x.js',
      language: 'javascript',
      content: 'x',
      stdinBuffer: '',
    });
    expect(payload.input).toBeUndefined();
  });
});

describe('encodeShareFragment / decodeShareFragment — round-trip', () => {
  it('round-trips the happy payload byte-equal', async () => {
    const encoded = await encodeShareFragment(happyPayload);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.fragment.startsWith(SHARE_FRAGMENT_PREFIX)).toBe(true);
    const decoded = await decodeShareFragment(encoded.fragment);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.payload).toEqual(happyPayload);
  });

  it('accepts a fragment with or without leading `#`', async () => {
    const encoded = await encodeShareFragment(happyPayload);
    if (!encoded.ok) throw new Error('encode failed in setup');
    const withHash = `#${encoded.fragment}`;
    const decoded = await decodeShareFragment(withHash);
    expect(decoded.ok).toBe(true);
  });

  it('emits a base64url alphabet only (no +, /, or =)', async () => {
    // Synthesize a payload whose gzip bytes are likely to include
    // 0xff / 0xfe → encoded as `/` / `+` in classic base64. The
    // 32-byte body deliberately spans every byte value to maximize
    // surface.
    const allBytes = Array.from({ length: 256 }, (_, i) =>
      String.fromCharCode(i)
    ).join('');
    const payload = buildSharePayload({
      name: 'bytes.js',
      language: 'javascript',
      content: allBytes,
    });
    const encoded = await encodeShareFragment(payload);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const body = encoded.fragment.slice(SHARE_FRAGMENT_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(body).not.toContain('+');
    expect(body).not.toContain('/');
    expect(body).not.toContain('=');
  });

  it('round-trips Spanish / emoji / multi-byte content losslessly', async () => {
    const content =
      '// Comentario en español con emojis 🚀🇪🇸\nconsole.log("café");';
    const payload = buildSharePayload({
      name: 'demo.js',
      language: 'javascript',
      content,
    });
    const encoded = await encodeShareFragment(payload);
    if (!encoded.ok) throw new Error('encode failed');
    const decoded = await decodeShareFragment(encoded.fragment);
    if (!decoded.ok) throw new Error('decode failed');
    expect(decoded.payload.source.content).toBe(content);
  });
});

describe('encodeShareFragment — reject paths', () => {
  it('starts draining the gzip readable before awaiting writer backpressure', async () => {
    const originalCompressionStream = globalThis.CompressionStream;
    const originalResponse = globalThis.Response;
    const fakeReadable = {};
    let drainStarted = false;
    let writeObservedDrainStarted: boolean | null = null;
    let releaseWrite: (() => void) | null = null;

    class FakeCompressionStream {
      readonly readable = fakeReadable as ReadableStream<Uint8Array>;
      readonly writable = {
        getWriter() {
          return {
            write: async () => {
              writeObservedDrainStarted = drainStarted;
              if (!drainStarted) {
                await new Promise<void>((resolve) => {
                  releaseWrite = resolve;
                });
              }
            },
            close: async () => {},
          };
        },
      } as WritableStream<Uint8Array>;
    }

    class FakeResponse {
      constructor(readable: unknown) {
        expect(readable).toBe(fakeReadable);
      }

      async arrayBuffer(): Promise<ArrayBuffer> {
        drainStarted = true;
        releaseWrite?.();
        return new Uint8Array([1, 2, 3]).buffer;
      }
    }

    Object.defineProperty(globalThis, 'CompressionStream', {
      configurable: true,
      writable: true,
      value: FakeCompressionStream,
    });
    Object.defineProperty(globalThis, 'Response', {
      configurable: true,
      writable: true,
      value: FakeResponse,
    });

    try {
      const result = await Promise.race([
        encodeShareFragment(happyPayload),
        new Promise<{ readonly timeout: true }>((resolve) =>
          setTimeout(() => resolve({ timeout: true }), 50)
        ),
      ]);
      expect('timeout' in result).toBe(false);
      expect(writeObservedDrainStarted).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'CompressionStream', {
        configurable: true,
        writable: true,
        value: originalCompressionStream,
      });
      Object.defineProperty(globalThis, 'Response', {
        configurable: true,
        writable: true,
        value: originalResponse,
      });
    }
  });

  it('rejects unknown language', async () => {
    const payload: SharePayloadV1 = {
      version: 1,
      tab: { name: 'x', language: 'not-a-real-language' },
      source: { content: 'x' },
    };
    const result = await encodeShareFragment(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-language');
  });

  it('rejects source larger than the pre-encode cap', async () => {
    const content = 'x'.repeat(MAX_SHARE_SOURCE_BYTES + 1);
    const payload = buildSharePayload({
      name: 'x.js',
      language: 'javascript',
      content,
    });
    const result = await encodeShareFragment(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('source-too-large');
    expect(result.sizeBytes).toBeGreaterThan(MAX_SHARE_SOURCE_BYTES);
  });

  it('rejects when the fragment exceeds the post-encode cap', async () => {
    // Content under the source cap but high-entropy enough that gzip
    // can't shrink it under the fragment cap. Random hex chars approx
    // 0.7 ratio after gzip.
    const random = Array.from({ length: 12000 }, (_, i) =>
      ((i * 9301 + 49297) % 233280).toString(36)
    ).join('');
    const content = random.slice(0, 12000);
    const payload = buildSharePayload({
      name: 'x.js',
      language: 'javascript',
      content,
    });
    const result = await encodeShareFragment(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fragment-too-large');
    expect(result.sizeBytes).toBeGreaterThan(MAX_SHARE_FRAGMENT_BYTES);
  });
});

describe('decodeShareFragment — reject paths', () => {
  it('rejects an unknown prefix', async () => {
    const result = await decodeShareFragment('not-the-share-prefix.xxx');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-prefix');
  });

  it('rejects an empty body after the prefix', async () => {
    const result = await decodeShareFragment(SHARE_FRAGMENT_PREFIX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-base64');
  });

  it('rejects tampered base64url alphabet', async () => {
    // `!@#` are outside the base64url alphabet.
    const result = await decodeShareFragment(
      `${SHARE_FRAGMENT_PREFIX}!@#abc`
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-base64');
  });

  it('rejects a corrupted gzip stream', async () => {
    // Valid base64url that does NOT decompress as gzip.
    const result = await decodeShareFragment(
      `${SHARE_FRAGMENT_PREFIX}AAAAAAAA`
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('gzip-corrupt');
  });

  it('rejects an unknown version', async () => {
    // Build a payload, then mutate version manually before encoding.
    const tampered: SharePayloadV1 = {
      ...happyPayload,
      version: 99 as unknown as 1,
    };
    const encoded = await encodeShareFragment(tampered);
    if (!encoded.ok) throw new Error('encode failed in setup');
    const decoded = await decodeShareFragment(encoded.fragment);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('unknown-version');
    expect(decoded.detail).toBe('99');
  });

  it('rejects a payload missing required fields', async () => {
    // Synthesize a payload-shaped object missing `tab.name`.
    const malformed = { version: 1, tab: { language: 'javascript' }, source: { content: 'x' } } as unknown as SharePayloadV1;
    const encoded = await encodeShareFragment(malformed);
    if (!encoded.ok) throw new Error('encode failed in setup');
    const decoded = await decodeShareFragment(encoded.fragment);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('shape-invalid');
  });

  it('rejects a payload whose language is not in LANGUAGE_PACKS', async () => {
    // Encode with a real language, mutate the JSON, re-gzip, re-encode
    // via a small helper to bypass the encoder's own validation.
    const encoded = await encodeViaSneakyPath({
      version: 1,
      tab: { name: 'x', language: 'klingon' },
      source: { content: 'x' },
    });
    const decoded = await decodeShareFragment(encoded);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('unknown-language');
    expect(decoded.detail).toBe('klingon');
  });

  it('rejects a gzip-bomb payload that decompresses past the cap', async () => {
    // Encode a payload that ALONE fits the fragment cap but
    // decompresses to over MAX_SHARE_DECOMPRESSED_BYTES (lots of
    // repetition compresses to <6KB but expands huge). Build a JSON
    // wrapper with a 65 KiB string content, encode via the sneaky
    // path (bypasses the source-too-large guard), then assert decode
    // catches it.
    const huge = 'a'.repeat(MAX_SHARE_DECOMPRESSED_BYTES + 1024);
    const encoded = await encodeViaSneakyPath(
      {
        version: 1,
        tab: { name: 'x.js', language: 'javascript' },
        source: { content: huge },
      },
      { allowOversizedFragment: true }
    );
    const decoded = await decodeShareFragment(encoded);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('oversized');
  });

  it('rejects source content that bypasses the encoder cap but fits the gzip cap', async () => {
    // Repeated content compresses small enough to pass the fragment
    // budget and stays below MAX_SHARE_DECOMPRESSED_BYTES, so this
    // specifically pins the decoder-side source cap.
    const encoded = await encodeViaSneakyPath({
      version: 1,
      tab: { name: 'x.js', language: 'javascript' },
      source: { content: 'a'.repeat(MAX_SHARE_SOURCE_BYTES + 1) },
    });
    const decoded = await decodeShareFragment(encoded);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.reason).toBe('oversized');
  });
});

describe('decodeShareFragment — drops unknown mode values silently', () => {
  it('keeps known modes and drops unknown values without rejecting', async () => {
    // Build a payload with a known mode, encode, decode normally.
    const payload = buildSharePayload({
      name: 'x.js',
      language: 'javascript',
      content: 'x',
      runtimeMode: 'worker',
    });
    const encoded = await encodeShareFragment(payload);
    if (!encoded.ok) throw new Error('encode failed in setup');
    const decoded = await decodeShareFragment(encoded.fragment);
    if (!decoded.ok) throw new Error('decode failed');
    expect(decoded.payload.modes).toEqual({ runtime: 'worker' });
  });

  it('drops payload-side unknown runtime / workflow on the decode pass', async () => {
    // Encode via sneaky path with bogus modes; decode must keep
    // known fields and drop unknowns.
    const fragment = await encodeViaSneakyPath({
      version: 1,
      tab: { name: 'x.js', language: 'javascript' },
      source: { content: 'x' },
      modes: {
        runtime: 'not-a-runtime' as unknown as 'worker',
        workflow: 'scratchpad',
        autoLog: false,
      },
    });
    const decoded = await decodeShareFragment(fragment);
    if (!decoded.ok) throw new Error('decode failed');
    expect(decoded.payload.modes).toEqual({
      workflow: 'scratchpad',
      autoLog: false,
    });
  });
});

describe('bucketShareSize — Fold G', () => {
  it('maps every boundary into a closed enum value', () => {
    expect(bucketShareSize(0)).toBe('<1kb');
    expect(bucketShareSize(1023)).toBe('<1kb');
    expect(bucketShareSize(1024)).toBe('<2kb');
    expect(bucketShareSize(2047)).toBe('<2kb');
    expect(bucketShareSize(2048)).toBe('<4kb');
    expect(bucketShareSize(4095)).toBe('<4kb');
    expect(bucketShareSize(4096)).toBe('<6kb');
    expect(bucketShareSize(6143)).toBe('<6kb');
    expect(bucketShareSize(6144)).toBe('>=6kb');
    expect(bucketShareSize(1024 * 1024)).toBe('>=6kb');
  });

  it('every returned bucket is a member of SHARE_SIZE_BUCKETS', () => {
    for (const n of [0, 500, 1500, 3000, 5000, 7000, 100_000]) {
      expect(SHARE_SIZE_BUCKETS).toContain(bucketShareSize(n));
    }
  });
});

describe('privacy invariant — payload never leaks sensitive fields', () => {
  it('the encoded fragment of a malicious tab never contains the tab leaks', async () => {
    // Even if a future builder accepts the malicious fields, the
    // shared SharePayloadV1 schema does not, so the JSON should not
    // mention them. This test pins the contract from the builder
    // outward.
    const maliciousInputs = {
      name: 'x.js',
      language: 'javascript',
      content: 'console.log(1)',
      // Build accepts only the known input fields; anything below is
      // ignored by TypeScript widening, which is the point.
    } as Parameters<typeof buildSharePayload>[0];
    // Add fields that should NEVER reach the payload via a cast.
    const malicious = {
      ...maliciousInputs,
      licenseToken: 'fake.jwt.token',
      filePath: '/Users/secret/.aws/credentials',
      rootId: 'cap_rootid_abc',
      relativePath: 'private/file.js',
      envVars: { OPENAI_API_KEY: 'sk-leak' },
    } as unknown as Parameters<typeof buildSharePayload>[0];

    const payload = buildSharePayload(malicious);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('licenseToken');
    expect(json).not.toContain('filePath');
    expect(json).not.toContain('rootId');
    expect(json).not.toContain('relativePath');
    expect(json).not.toContain('envVars');
    expect(json).not.toContain('OPENAI_API_KEY');
    expect(json).not.toContain('sk-leak');
    expect(json).not.toContain('.aws');
  });

  it('decoder ignores extra adversarial fields silently', async () => {
    const fragment = await encodeViaSneakyPath({
      version: 1,
      tab: { name: 'x.js', language: 'javascript' },
      source: { content: 'console.log(1)' },
      // Adversarial top-level / nested extras.
      licenseToken: 'fake',
      env: { LINGUA_LICENSE_PRIVATE_KEY_JWK: 'leak' },
    } as unknown as SharePayloadV1);
    const decoded = await decodeShareFragment(fragment);
    if (!decoded.ok) throw new Error('decode failed');
    expect(decoded.payload).toEqual({
      version: 1,
      tab: { name: 'x.js', language: 'javascript' },
      source: { content: 'console.log(1)' },
    });
    expect(JSON.stringify(decoded.payload)).not.toContain('licenseToken');
    expect(JSON.stringify(decoded.payload)).not.toContain('LINGUA_LICENSE');
  });
});

// ---------------------------------------------------------------------------
// Sneaky path — bypasses the encoder's pre-validation so we can craft
// adversarial fragments (klingon language, gzip bomb, malformed shape)
// the way an attacker would. Lives only here.
// ---------------------------------------------------------------------------

async function encodeViaSneakyPath(
  payload: unknown,
  options: { allowOversizedFragment?: boolean } = {}
): Promise<string> {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const buffer = await new Response(cs.readable).arrayBuffer();
  const gz = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < gz.byteLength; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(gz.subarray(i, i + CHUNK))
    );
  }
  const base64 = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
  const fragment = `${SHARE_FRAGMENT_PREFIX}${base64}`;
  if (
    !options.allowOversizedFragment &&
    fragment.length > MAX_SHARE_FRAGMENT_BYTES
  ) {
    throw new Error(
      `sneaky encode produced an oversized fragment (${fragment.length}); pass allowOversizedFragment: true`
    );
  }
  return fragment;
}

describe('constants are pinned to expected values', () => {
  it('matches the public contract for downstream consumers', () => {
    expect(SHARE_PAYLOAD_VERSION).toBe(1);
    expect(SHARE_FRAGMENT_PREFIX).toBe('share=v1.');
    expect(MAX_SHARE_FRAGMENT_BYTES).toBe(6144);
    expect(MAX_SHARE_SOURCE_BYTES).toBe(16384);
    expect(MAX_SHARE_STDIN_BYTES).toBe(4096);
    expect(MAX_SHARE_DECOMPRESSED_BYTES).toBe(64 * 1024);
  });
});
