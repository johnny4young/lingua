import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';

import showcase from '../src/data/tour-showcase.json' with { type: 'json' };
import integrity from '../src/data/tour-showcase.integrity.json' with { type: 'json' };
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const MAX_SCREENSHOT_BYTES = 200 * 1024;

function fingerprint(bytes: Buffer): string {
  return `${bytes.byteLength}B sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

describe('landing tour', () => {
  it('ships every tour frame from the capture spec with a recorded digest', () => {
    const recorded = integrity.screenshots as Record<string, { bytes: number; sha256: string }>;
    const expectedKeys: string[] = [];
    for (const item of showcase.items) {
      for (const locale of ['en', 'es'] as const) {
        const key = `${item.id}/${locale}`;
        expectedKeys.push(key);
        const bytes = readFileSync(path.join(websiteRoot, 'public', item.images[locale]));
        assert.ok(bytes.byteLength <= MAX_SCREENSHOT_BYTES, `${key} exceeds ${MAX_SCREENSHOT_BYTES} bytes`);
        const entry = recorded[key];
        assert.ok(entry, `${key} has no recorded digest; run "npm --prefix website run sync:tour-evidence"`);
        assert.equal(
          fingerprint(bytes),
          `${entry.bytes}B sha256:${entry.sha256}`,
          `${key} does not match its recorded digest — regenerate it with ${item.spec}`
        );
      }
    }
    assert.deepEqual(Object.keys(recorded).sort(), expectedKeys.sort());
  });

  it('points each locale at its own captures', () => {
    for (const [locale, copy] of [['en', en], ['es', es]] as const) {
      const images = copy.home.tour.items.map(item => item.image);
      assert.deepEqual(
        images,
        showcase.items.map(item => item.images[locale]),
        `${locale} tour order or images drifted from tour-showcase.json`
      );
      const aiShot = copy.home.ai.shot.image;
      assert.ok(existsSync(path.join(websiteRoot, 'public', aiShot)), `${locale} AI shot ${aiShot} is missing`);
    }
    assert.notEqual(es.home.ai.shot.image, en.home.ai.shot.image, 'the Spanish AI shot reuses the English capture');
  });
});
