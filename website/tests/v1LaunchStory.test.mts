import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';

import showcase from '../src/data/v1-showcase.json' with { type: 'json' };
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
const MAX_SCREENSHOT_BYTES = 200 * 1024;

function pngDimensions(filePath: string): { width: number; height: number } {
  const header = readFileSync(filePath).subarray(0, 24);
  assert.equal(header.toString('hex', 0, 8), '89504e470d0a1a0a', `${filePath} is not PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
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
        assert.deepEqual(pngDimensions(publicPath), {
          width: item.width,
          height: item.height,
        });
        assert.ok(
          statSync(publicPath).size <= MAX_SCREENSHOT_BYTES,
          `${item.id}/${locale} exceeds ${MAX_SCREENSHOT_BYTES} bytes`
        );

        const sourcePath = path.join(repoRoot, item.sources[locale]);
        if (existsSync(sourcePath)) {
          assert.deepEqual(
            readFileSync(publicPath),
            readFileSync(sourcePath),
            `${item.id}/${locale} is stale relative to deterministic evidence`
          );
        }
      }
    }
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
