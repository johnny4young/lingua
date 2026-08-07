import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';

import showcase from '../src/data/v1-showcase.json' with { type: 'json' };
import integrity from '../src/data/v1-showcase.integrity.json' with { type: 'json' };
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
const MAX_SCREENSHOT_BYTES = 200 * 1024;

function pngDimensions(header: Buffer, filePath: string): { width: number; height: number } {
  assert.equal(header.toString('hex', 0, 8), '89504e470d0a1a0a', `${filePath} is not PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/**
 * Describe an image as one short string.
 *
 * Never compare the buffers themselves. `assert.deepEqual` on two ~100KB
 * Buffers that differ makes node:assert build an element-by-element diff: it
 * burned 160s and then died with exit code 137, and node:test reported the
 * OOM as a bare module-level failure with no message at all. A digest fails in
 * about a millisecond and prints something a human can act on.
 */
function fingerprint(bytes: Buffer): string {
  return `${bytes.byteLength}B sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

describe('v1 launch story', () => {
  it('keeps one ordered visual contract across English and Spanish', () => {
    assert.equal(showcase.schemaVersion, 1);
    assert.equal(showcase.items.length, 6);

    const ids = showcase.items.map(item => item.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(en.home.whatsNew.items.map(item => item.id), ids);
    assert.deepEqual(es.home.whatsNew.items.map(item => item.id), ids);
    assert.match(en.home.whatsNew.releaseTitle, /Lingua 1\.0/u);
    assert.match(es.home.whatsNew.releaseTitle, /Lingua 1\.0/u);
    assert.doesNotMatch(en.home.whatsNew.title, /1\.0/u);
    assert.doesNotMatch(es.home.whatsNew.title, /1\.0/u);

    for (const locale of [en, es]) {
      for (const item of locale.home.whatsNew.items) {
        assert.ok(item.availability.length > 8, `${item.id} needs specific availability copy`);
        assert.ok(item.alt.length > 40, `${item.id} needs descriptive alternative text`);
      }
    }
  });

  it('ships bounded bilingual PNGs with declared dimensions', () => {
    for (const item of showcase.items) {
      assert.notEqual(item.images.en, item.images.es);
      assert.ok(existsSync(path.join(repoRoot, item.spec)), `${item.id} evidence spec is missing`);
      for (const locale of ['en', 'es'] as const) {
        const publicPath = path.join(websiteRoot, 'public', item.images[locale]);
        assert.ok(existsSync(publicPath), `${item.id}/${locale} screenshot is missing`);
        const bytes = readFileSync(publicPath);
        assert.deepEqual(pngDimensions(bytes.subarray(0, 24), publicPath), {
          width: item.width,
          height: item.height,
        });
        assert.ok(
          bytes.byteLength <= MAX_SCREENSHOT_BYTES,
          `${item.id}/${locale} exceeds ${MAX_SCREENSHOT_BYTES} bytes`
        );
      }
    }
  });

  it('ships the exact bytes recorded when the gallery last landed', () => {
    // This replaces a comparison against output/playwright/**, which is
    // gitignored. That comparison was skipped on every fresh clone and every
    // CI runner — the only places it could have been load-bearing — and it
    // could never have passed there anyway, since the shipped PNGs were
    // rasterized by Chromium on macOS and a Linux runner emits different
    // bytes for the same page. Comparing against a committed digest asks the
    // question that IS portable: did anything change the shipped assets
    // without going through website/scripts/sync-showcase-evidence.mts.
    const recorded = integrity.screenshots as Record<string, { bytes: number; sha256: string }>;
    const expectedKeys: string[] = [];

    for (const item of showcase.items) {
      for (const locale of ['en', 'es'] as const) {
        const key = `${item.id}/${locale}`;
        expectedKeys.push(key);
        const entry = recorded[key];
        assert.ok(
          entry,
          `${key} has no recorded digest; run "npm run sync:showcase-evidence -- --record" after updating the gallery`
        );
        assert.equal(
          fingerprint(readFileSync(path.join(websiteRoot, 'public', item.images[locale]))),
          `${entry.bytes}B sha256:${entry.sha256}`,
          `${key} does not match its recorded digest — regenerate it from the spec named in v1-showcase.json (${item.spec}) rather than re-recording the digest`
        );
      }
    }

    // A digest map that has drifted out of step with the showcase is how a
    // deleted or renamed item would slip past the loop above unnoticed.
    assert.deepEqual(
      Object.keys(recorded).sort(),
      expectedKeys.sort(),
      'v1-showcase.integrity.json and v1-showcase.json disagree on which screenshots exist'
    );
  });

  it('keeps the README visual overview aligned with the English gallery', () => {
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    for (const item of showcase.items) {
      assert.ok(
        readme.includes(item.images.en.replace(/^\//u, 'website/public/')),
        `README omits ${item.id}`
      );
    }
  });
});
