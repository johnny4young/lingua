#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(WEBSITE_ROOT, '..');
const ENGLISH_DIR = join(REPO_ROOT, 'docs', 'seo-pages');
const VENDORED_ENGLISH_DIR = join(WEBSITE_ROOT, 'src', 'content', 'seo', 'en');
const SPANISH_DIR = join(WEBSITE_ROOT, 'src', 'content', 'seo', 'es');

const REQUIRED_FRONT_MATTER = ['title', 'description', 'canonical', 'ogImage', 'language'];
const LOCALE_SECTIONS = {
  en: ['## What actually runs', "## What doesn't work today", '## Download'],
  es: ['## Lo que sí corre', '## Lo que no funciona hoy', '## Descargar'],
};

const STALE_CLAIMS = [
  /No Go LSP integration yet/iu,
  /Aún no hay integración Go LSP/iu,
  /No es un notebook/iu,
  /No hay modo Node\.js todavía/iu,
  /No hay modo notebook todavía/iu,
  /No hay LSP más allá de los servicios integrados/iu,
  /No hay (?:debugger ni )?Rust Analyzer integrado/iu,
];

function parseFrontMatter(raw, filename) {
  const match = raw.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n/u);
  if (!match) throw new Error(`${filename}: missing YAML front matter`);

  const data = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/u);
    if (!field) continue;
    const [, key, value = ''] = field;
    data[key] = value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2');
  }
  return { data, body: raw.slice(match[0].length) };
}

async function markdownFiles(directory) {
  return (await readdir(directory))
    .filter(name => name.endsWith('.md') && name !== 'README.md')
    .sort();
}

async function validateLocale(locale, directory, filenames, errors) {
  const prefix = locale === 'es' ? '/es' : '';
  for (const filename of filenames) {
    const slug = filename.replace(/\.md$/u, '');
    const raw = await readFile(join(directory, filename), 'utf8');
    let parsed;
    try {
      parsed = parseFrontMatter(raw, `${locale}/${filename}`);
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    const { data, body } = parsed;
    for (const key of REQUIRED_FRONT_MATTER) {
      if (!data[key]) errors.push(`${locale}/${filename}: missing ${key}`);
    }

    if ((data.description ?? '').length > 160) {
      errors.push(`${locale}/${filename}: description exceeds 160 characters`);
    }

    const expectedCanonical = `https://linguacode.dev${prefix}/${slug}`;
    if (data.canonical !== expectedCanonical) {
      errors.push(
        `${locale}/${filename}: canonical must be ${expectedCanonical}, got ${data.canonical ?? 'nothing'}`
      );
    }

    const h1Count = body.match(/^#\s+/gmu)?.length ?? 0;
    if (h1Count !== 1)
      errors.push(`${locale}/${filename}: expected exactly one H1, got ${h1Count}`);

    for (const heading of LOCALE_SECTIONS[locale]) {
      if (!body.includes(heading)) errors.push(`${locale}/${filename}: missing ${heading}`);
    }

    if (!body.includes('https://linguacode.dev')) {
      errors.push(`${locale}/${filename}: missing canonical download link`);
    }

    if (/\binternal\b/iu.test(body)) {
      errors.push(`${locale}/${filename}: public copy leaks an internal planning reference`);
    }
    if (/\b(?:ENG|SEO|P|T)-\d+\b/u.test(body)) {
      errors.push(`${locale}/${filename}: public copy leaks a private planning identifier`);
    }
    for (const claim of STALE_CLAIMS) {
      if (claim.test(body))
        errors.push(`${locale}/${filename}: contains a known stale product claim`);
    }
  }
}

async function main() {
  const errors = [];
  const english = await markdownFiles(ENGLISH_DIR);
  const vendoredEnglish = await markdownFiles(VENDORED_ENGLISH_DIR);
  const spanish = await markdownFiles(SPANISH_DIR);

  if (JSON.stringify(english) !== JSON.stringify(spanish)) {
    errors.push(`EN/ES slug drift\n  EN: ${english.join(', ')}\n  ES: ${spanish.join(', ')}`);
  }
  if (JSON.stringify(english) !== JSON.stringify(vendoredEnglish)) {
    errors.push('Vendored English SEO slugs drift from docs/seo-pages');
  }

  await validateLocale('en', ENGLISH_DIR, english, errors);
  await validateLocale('es', SPANISH_DIR, spanish, errors);

  for (const filename of english) {
    const source = await readFile(join(ENGLISH_DIR, filename), 'utf8');
    const vendored = await readFile(join(VENDORED_ENGLISH_DIR, filename), 'utf8').catch(() => null);
    if (vendored !== source) errors.push(`seo/en/${filename}: vendored copy is out of sync`);
  }

  if (errors.length > 0) {
    console.error(`SEO content validation failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`SEO content validation passed for ${english.length} bilingual landing pages.`);
}

await main();
