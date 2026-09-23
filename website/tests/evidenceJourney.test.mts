import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
const read = (name: string) => readFileSync(path.join(repoRoot, name), 'utf8');

test('home leads to a bilingual evidence walkthrough with honest availability', () => {
  const hero = read('website/src/components/Hero.astro');
  assert.match(hero, /localizePath\(locale, '\/docs\/reproducible-run'\)/u);

  for (const [locale, copy] of [['en', en], ['es', es]] as const) {
    assert.ok(copy.home.hero.demoLink.length > 10, `${locale}: missing demo CTA`);
    assert.match(copy.home.hero.browserAvailability, /Free/u);
    assert.match(copy.home.hero.desktopAvailability, /Go/u);
    assert.match(copy.home.hero.capsuleAvailability, /Free/u);
    assert.match(copy.home.hero.capsuleAvailability, /Pro|paid|pago/u);
    assert.match(copy.pricing.faq.find(item => /offline/u.test(item.q))?.a ?? '', /cache|caché/u);
    assert.match(copy.pricing.faq.find(item => /MCP/u.test(item.q))?.a ?? '', /read.only|solo lectura/u);
    assert.doesNotMatch(copy.home.privacyCallout.bodyStart, /nothing leaves|nada sale/iu);
    assert.match(copy.home.privacyCallout.bodyStart, /HTTP/u);
  }
});

test('full navigation waits until localized labels and actions fit', () => {
  const header = read('website/src/components/Header.astro');
  assert.match(header, /@media \(min-width: 1280px\)/u);
  assert.match(header, /@media \(max-width: 1279px\)/u);
});

test('the bilingual walkthrough covers error recovery and separates validation from replay', () => {
  const guides = ['en', 'es'].map(locale =>
    read(`website/src/content/docs/${locale}/reproducible-run.md`)
  );
  for (const guide of guides) {
    assert.match(guide, /const x = 1 \+ 2; console\.log\(x\);/u);
    assert.match(guide, /throw new Error\('demo failure'\)/u);
    assert.match(guide, /lingua capsule validate/u);
    assert.match(guide, /lingua capsule replay/u);
    assert.match(guide, /deterministic-run\.capsule\.json/u);
    assert.match(guide, /MCP/u);
    assert.match(guide, /File System Access/u);
  }
  assert.doesNotMatch(guides.join('\n'), /api\.github\.com/u);

  const example = JSON.parse(read('docs/examples/deterministic-run.capsule.json'));
  assert.equal(example.source.content, 'const x = 1 + 2; console.log(x);');
  assert.equal(example.result.stdout, '3\n');
});

test('getting started limits offline claims to bundled local runtimes', () => {
  const enGuide = read('website/src/content/docs/en/getting-started.md');
  const esGuide = read('website/src/content/docs/es/getting-started.md');
  assert.doesNotMatch(enGuide, /Install it once and you have .*Go, and Rust ready/u);
  assert.doesNotMatch(esGuide, /Lo instalas una vez y tienes .*Go y Rust listos/u);
  assert.doesNotMatch(enGuide, /Lingua does not need a network connection to run code on the desktop build/u);
  assert.doesNotMatch(esGuide, /Lingua no necesita conexión para ejecutar código en el build desktop/u);
  assert.match(enGuide, /## What works offline/u);
  assert.match(esGuide, /## Qué funciona sin conexión/u);
  for (const guide of [enGuide, esGuide]) {
    assert.match(guide, /HTTP/u);
    assert.match(guide, /Go\/Rust|Go and Rust|Go y Rust/u);
  }
});

test('pilot protocol requires consent and records blockers without collecting code or paths', () => {
  const script = read('docs/runbooks/evidence-journey-pilot.md');
  assert.match(script, /consent/u);
  assert.match(script, /time to|completion time/u);
  assert.match(script, /blocker/u);
  assert.match(script, /not collect\s+source code/u);
  assert.match(script, /not run|external/u);
});
