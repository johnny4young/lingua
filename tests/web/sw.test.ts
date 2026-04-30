/**
 * Pin tests for `public/sw.js`. We don't spin up a full ServiceWorker
 * context (it requires `self.registration`, `caches`, etc.) — instead
 * we read the source as text and assert the structural invariants
 * the renderer relies on for cross-origin API safety.
 *
 * The full end-to-end behaviour (API-origin requests are NOT in
 * `caches.keys()`) is covered by the browser smoke described in
 * AGENTS.md. These tests just keep a refactor from silently removing
 * the bypass and reintroducing the cache-poisoning bug from
 * RL-061.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SW_PATH = path.resolve(__dirname, '../../public/sw.js');

let cachedSource: string | null = null;
async function readSwSource(): Promise<string> {
  if (cachedSource !== null) return cachedSource;
  cachedSource = await readFile(SW_PATH, 'utf-8');
  return cachedSource;
}

describe('public/sw.js — API origin cache bypass', () => {
  it('lists licenses.linguacode.dev in the passthrough allow-list so /licenses/* never enters the cache', async () => {
    const source = await readSwSource();
    expect(source).toMatch(/const\s+PASSTHROUGH_ORIGINS\s*=/);
    expect(source).toContain("'https://licenses.linguacode.dev'");
  });

  it('lists updates.linguacode.dev in the passthrough allow-list so /web/version is never cached by the app shell', async () => {
    const source = await readSwSource();
    expect(source).toMatch(/const\s+PASSTHROUGH_ORIGINS\s*=/);
    expect(source).toContain("'https://updates.linguacode.dev'");
  });

  it('bumps CACHE_VERSION past v1 so existing clients drop any pre-fix license-status entries on first activate', async () => {
    const source = await readSwSource();
    const match = source.match(/const\s+CACHE_VERSION\s*=\s*'(v\d+)'/);
    expect(match).not.toBeNull();
    if (match) {
      const version = parseInt(match[1]!.slice(1), 10);
      expect(version).toBeGreaterThanOrEqual(2);
    }
  });

  it('short-circuits the fetch handler for license origins WITHOUT calling event.respondWith — letting the browser default fetch run untouched', async () => {
    const source = await readSwSource();
    // The fragile-but-pinned contract: there must be a branch that
    // checks `PASSTHROUGH_ORIGINS.includes(url.origin)` BEFORE any
    // respondWith / cache lookup the rest of the handler does. The
    // bypass uses an early `return;` (no respondWith) so cache.put
    // can't run on the response.
    expect(source).toMatch(/PASSTHROUGH_ORIGINS\.includes\(url\.origin\)/);
    // Sanity: the early return exists and is structured as expected.
    // Match across the bare `return;` line that follows the includes()
    // check so the test fails if a refactor flips it to respondWith.
    const bypassRegex = /if\s*\(\s*PASSTHROUGH_ORIGINS\.includes\(url\.origin\)\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}/;
    expect(source).toMatch(bypassRegex);
  });
});
