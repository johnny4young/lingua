import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

// Exercise Astro's actual image dependencies, not a separately installed copy.
const requireFromAstro = createRequire(import.meta.resolve('astro/package.json'));
const { optimize } = requireFromAstro('svgo') as typeof import('svgo');
const sharp = requireFromAstro('sharp') as typeof import('sharp');

describe('website image dependency regressions', () => {
  // These fixtures cover specific removeScripts bypasses. SVGO is an optimizer,
  // not a general-purpose sanitizer for arbitrary untrusted SVG documents.
  for (const [name, anchor, text] of [
    ['SVG namespace anchor', 'svg:a', 'javascript:alert(1)'],
    ['tab in scheme', 'a', 'java&#9;script:alert(1)'],
    ['line feed in scheme', 'a', 'java&#10;script:alert(1)'],
    ['carriage return in scheme', 'a', 'java&#13;script:alert(1)'],
  ]) {
    it(`removes an executable link with ${name}`, () => {
      const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg"><${anchor} href="${text}"><text>label</text></${anchor}></svg>`;
      const { data } = optimize(source, { plugins: ['removeScripts'] });
      assert.doesNotMatch(data, /href=/u);
      assert.match(data, /<text>label<\/text>/u);
    });
  }

  it('preserves a normal HTTPS link', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://linguacode.dev"><text>label</text></a></svg>';
    const { data } = optimize(source, { plugins: ['removeScripts'] });
    assert.match(data, /href="https:\/\/linguacode\.dev"/u);
  });

  it('round-trips a small trusted AVIF through the native image pipeline', async () => {
    const encoded = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#336699' },
    }).avif().toBuffer();
    const { info } = await sharp(encoded).resize(4, 4).png().toBuffer({ resolveWithObject: true });
    assert.equal(info.format, 'png');
    assert.equal(info.width, 4);
    assert.equal(info.height, 4);
  });
});
