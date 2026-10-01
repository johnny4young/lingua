/** Canonical UTF-8 SHA-256 helper, independent of Capsule parsing/redaction. */
export async function computeContentHash(content: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('computeContentHash: Web Crypto unavailable (no globalThis.crypto.subtle)');
  }
  const bytes = new TextEncoder().encode(content);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
