#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(WEBSITE_ROOT, '..');

const PUBLIC_FILES = [
  'docs/press-kit/README.md',
  'docs/press-kit/boilerplate.md',
  'docs/press-kit/launch-copy.md',
  'docs/press-kit/pricing-one-pager.md',
  'website/public/press/README.txt',
  'website/src/components/LanguageMatrix.astro',
  'website/src/content/docs/en/getting-started.md',
  'website/src/content/docs/es/getting-started.md',
  'website/src/i18n/en.ts',
  'website/src/i18n/es.ts',
  'website/src/lib/comparisons.ts',
  'website/src/lib/site.ts',
  'website/src/pages/features.astro',
  'website/src/pages/index.astro',
  'website/src/pages/licensing.astro',
  'website/src/pages/es/licensing.astro',
];

const STALE_CLAIMS = [
  /five languages/iu,
  /cinco lenguajes/iu,
  /five[- ]language/iu,
  /runner de cinco lenguajes/iu,
  /five runners/iu,
  /cinco runners/iu,
  /single-tab/iu,
  /one tab, five snippets/iu,
  /una pestaña, cinco snippets/iu,
  /no Go LSP/iu,
];

function captureNumber(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*(\\d+)`, 'u'));
  if (!match) throw new Error(`src/shared/entitlements.ts: cannot read ${name}`);
  return Number(match[1]);
}

function captureFreeLanguages(source) {
  const match = source.match(/allowedLanguages:\s*\[([^\]]+)\]/u);
  if (!match) throw new Error('src/shared/entitlements.ts: cannot read allowedLanguages');
  return [...match[1].matchAll(/'([^']+)'/gu)].map(([, language]) => language);
}

function between(source, start, end, filename) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from === -1 || to === -1) throw new Error(`${filename}: cannot isolate ${start}`);
  return source.slice(from, to);
}

function requireText(source, expected, filename, errors) {
  if (!source.includes(expected)) errors.push(`${filename}: missing ${expected}`);
}

async function main() {
  const errors = [];
  const entitlementSource = await readFile(join(REPO_ROOT, 'src/shared/entitlements.ts'), 'utf8');
  const contract = {
    tabs: captureNumber(entitlementSource, 'maxOpenTabs'),
    snippets: captureNumber(entitlementSource, 'maxSnippets'),
    freeLanguages: captureFreeLanguages(entitlementSource),
    paidLanguages: ['go', 'rust'],
  };
  const runnerCount = contract.freeLanguages.length + contract.paidLanguages.length;

  const contents = new Map();
  for (const filename of PUBLIC_FILES) {
    const source = await readFile(join(REPO_ROOT, filename), 'utf8');
    contents.set(filename, source);
    for (const stale of STALE_CLAIMS) {
      if (stale.test(source)) errors.push(`${filename}: contains stale claim ${stale.source}`);
    }
  }

  const english = contents.get('website/src/i18n/en.ts');
  const spanish = contents.get('website/src/i18n/es.ts');
  const pricing = contents.get('docs/press-kit/pricing-one-pager.md');
  const matrix = contents.get('website/src/components/LanguageMatrix.astro');
  const licensingEn = contents.get('website/src/pages/licensing.astro');
  const licensingEs = contents.get('website/src/pages/es/licensing.astro');

  requireText(
    english,
    `{ value: '${runnerCount}', label: 'runnable languages' }`,
    'website/src/i18n/en.ts',
    errors
  );
  requireText(
    spanish,
    `{ value: '${runnerCount}', label: 'lenguajes ejecutables' }`,
    'website/src/i18n/es.ts',
    errors
  );
  requireText(english, `${contract.tabs} open tabs at a time`, 'website/src/i18n/en.ts', errors);
  requireText(
    spanish,
    `${contract.tabs} pestañas abiertas a la vez`,
    'website/src/i18n/es.ts',
    errors
  );
  requireText(
    english,
    `Up to ${contract.snippets} saved snippets`,
    'website/src/i18n/en.ts',
    errors
  );
  requireText(
    spanish,
    `Hasta ${contract.snippets} snippets guardados`,
    'website/src/i18n/es.ts',
    errors
  );

  for (const language of ['JavaScript', 'TypeScript', 'Python', 'Ruby']) {
    requireText(pricing, language, 'docs/press-kit/pricing-one-pager.md', errors);
    requireText(
      matrix,
      `name: '${language}', state: 'runnable'`,
      'website/src/components/LanguageMatrix.astro',
      errors
    );
  }
  for (const price of ['$5', '$59', '$3'])
    requireText(pricing, price, 'docs/press-kit/pricing-one-pager.md', errors);
  requireText(pricing, '| Team', 'docs/press-kit/pricing-one-pager.md', errors);

  const pricingEn = between(
    pricing,
    '## English',
    '## Español',
    'docs/press-kit/pricing-one-pager.md'
  );
  const pricingEs = pricing.slice(pricing.indexOf('## Español'));
  const freeEn = between(pricingEn, '| Free', '| Monthly', 'docs/press-kit/pricing-one-pager.md');
  const freeEs = between(pricingEs, '| Free', '| Mensual', 'docs/press-kit/pricing-one-pager.md');
  if (/notebook/iu.test(freeEn) || /notebook/iu.test(freeEs)) {
    errors.push('docs/press-kit/pricing-one-pager.md: Free row must not include paid notebooks');
  }

  for (const [filename, source, capabilities] of [
    ['website/src/pages/licensing.astro', licensingEn, ['notebook', 'AI', 'execution']],
    ['website/src/pages/es/licensing.astro', licensingEs, ['notebook', 'IA', 'ejecución']],
  ]) {
    for (const capability of capabilities) {
      if (!new RegExp(capability, 'iu').test(source))
        errors.push(`${filename}: paid scope omits ${capability}`);
    }
    if (/all 31 developer utilities|las 31 utilidades developer/iu.test(source)) {
      errors.push(`${filename}: incorrectly presents every single-shot utility as paid-only`);
    }
  }

  if (errors.length > 0) {
    console.error(`Public product-copy validation failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Public product-copy validation passed: ${runnerCount} runners; Free=${contract.tabs} tabs/${contract.snippets} snippets/${contract.freeLanguages.join(', ')}.`
  );
}

await main();
