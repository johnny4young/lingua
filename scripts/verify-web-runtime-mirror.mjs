#!/usr/bin/env node

/** Verify the bytes served by the public WASM mirror before Pages promotion. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_ORIGIN = 'https://app.linguacode.dev';
const REQUEST_TIMEOUT_MS = 120_000;

async function digestStream(stream) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk);
    bytes += chunk.byteLength;
  }
  if (bytes === 0) throw new Error('Runtime WASM asset is empty');
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * CORS alone is insufficient: a 404 or altered R2 object can carry a valid
 * ACAO header. Stream both copies to avoid buffering a ~40 MiB WASM in CI.
 */
export async function verifyWebRuntimeMirror(filePath, url, { origin = DEFAULT_ORIGIN } = {}) {
  const expected = await digestStream(createReadStream(filePath));
  let response;
  try {
    response = await fetch(url, {
      headers: { Origin: origin },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Runtime mirror request failed (network, timeout, or redirect): ${url}`, {
      cause: error,
    });
  }

  if (response.headers.has('cf-mitigated')) {
    throw new Error(`Cloudflare challenge blocked runtime mirror verification: ${url}`);
  }
  if (response.status !== 200) {
    throw new Error(`Runtime mirror returned HTTP ${response.status}: ${url}`);
  }
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  if (allowedOrigin !== '*' && allowedOrigin !== origin) {
    throw new Error(`Runtime mirror CORS does not allow ${origin}: ${url}`);
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/wasm') {
    throw new Error(
      `Runtime mirror must serve application/wasm, got ${contentType ?? 'none'}: ${url}`
    );
  }
  if (!response.body) throw new Error(`Runtime mirror returned an empty body: ${url}`);
  const actual = await digestStream(response.body);
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
    throw new Error(
      `Runtime mirror digest mismatch: expected sha256 ${expected.sha256} (${expected.bytes} bytes), ` +
        `got ${actual.sha256} (${actual.bytes} bytes): ${url}`
    );
  }
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filePath, url, ...extra] = process.argv.slice(2);
  if (!filePath || !url || extra.length > 0) {
    console.error(
      'Usage: node scripts/verify-web-runtime-mirror.mjs <local-wasm-file> <public-url>'
    );
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyWebRuntimeMirror(filePath, url);
      console.log(
        `runtime mirror verified: ${url} sha256 ${result.sha256} (${result.bytes} bytes)`
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
