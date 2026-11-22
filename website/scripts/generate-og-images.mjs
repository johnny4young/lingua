#!/usr/bin/env node
/**
 * Render the Open Graph PNGs: one default per locale plus one per SEO page.
 * Social crawlers ignore SVG `og:image`, so the shipped cards are PNG.
 *
 *   node scripts/generate-og-images.mjs          # write public/assets/og/**
 *   node scripts/generate-og-images.mjs --check  # exit 1 when a card is missing
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(websiteRoot, 'public');
const seoDir = join(websiteRoot, 'src', 'content', 'seo');
const checkOnly = process.argv.includes('--check');
// Outlined wordmark written by the repo's scripts/brand/generate-brand-assets.mjs.
const wordmark = readFileSync(join(websiteRoot, 'scripts', 'og-wordmark.svg'), 'utf8');
const wordmarkViewBox = wordmark.match(/viewBox="([^"]+)"/u)[1].split(' ').map(Number);
const wordmarkShapes = wordmark.replace(/^[\s\S]*?<\/title>|<\/svg>\s*$/gu, '').trim();

/** Places the wordmark with its top-left corner at (x, y), `height` px tall. */
function wordmarkAt(x, y, height) {
  const [minX, minY, , boxHeight] = wordmarkViewBox;
  const scale = height / boxHeight;
  return `<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)}) translate(${-minX} ${-minY})">${wordmarkShapes}</g>`;
}

const DEFAULTS = {
  en: {
    output: '/assets/og/default.png',
    hero: true,
    subtitle: 'Multi-language code runner for your desktop',
    tag: 'JS · TS · Python · Go · Rust · Ruby',
  },
  es: {
    output: '/assets/og/es/default.png',
    hero: true,
    subtitle: 'Ejecutor de código multilenguaje para tu escritorio',
    tag: 'JS · TS · Python · Go · Rust · Ruby',
  },
};

function frontMatter(raw) {
  const block = raw.match(/^---\r?\n([\s\S]+?)\r?\n---/u)?.[1] ?? '';
  const data = {};
  for (const line of block.split(/\r?\n/u)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/u);
    if (field) data[field[1]] = field[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2');
  }
  return data;
}

function escapeXml(text) {
  return text.replace(/[<>&"']/gu, char => `&#${char.charCodeAt(0)};`);
}

/** Greedy word wrap by character budget; the card font is close to monospaced width. */
function wrap(text, maxChars, maxLines) {
  const lines = [];
  let current = '';
  for (const word of text.split(/\s+/u)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s,.;:—-]+$/u, '')}…`;
  }
  return lines;
}

/** A hero card (the locale default) sets the wordmark large in place of a title. */
function cardSvg({ hero = false, title = '', subtitle, tag }) {
  const titleLines = hero ? [] : wrap(title, 26, 2);
  const subtitleLines = wrap(subtitle, 58, 3);
  const titleY = 300 - (titleLines.length - 1) * 40;
  const subtitleY = hero ? 360 : titleY + titleLines.length * 84 + 8;
  const sans = "Helvetica Neue, Helvetica, Arial, sans-serif";
  const mono = 'Menlo, Consolas, monospace';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0c1017"/>
      <stop offset="100%" stop-color="#11161f"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${hero ? wordmarkAt(80, 170, 132) : wordmarkAt(80, 84, 56)}
  ${tag ? `<text x="1120" y="130" text-anchor="end" font-family="${mono}" font-size="24" fill="#67e8f9">${escapeXml(tag)}</text>` : ''}
  ${titleLines
    .map(
      (line, index) =>
        `<text x="80" y="${titleY + index * 84}" font-family="${sans}" font-size="72" font-weight="800" fill="#e5e7eb" letter-spacing="-2">${escapeXml(line)}</text>`
    )
    .join('\n  ')}
  ${subtitleLines
    .map(
      (line, index) =>
        `<text x="80" y="${subtitleY + index * 44}" font-family="${sans}" font-size="32" font-weight="500" fill="#9ca3af">${escapeXml(line)}</text>`
    )
    .join('\n  ')}
  <rect x="80" y="560" width="80" height="4" fill="#67e8f9"/>
  <text x="180" y="572" font-family="${mono}" font-size="20" fill="#6b7280">linguacode.dev</text>
</svg>`;
}

async function seoCards() {
  const cards = [];
  for (const locale of ['en', 'es']) {
    const directory = join(seoDir, locale);
    for (const filename of (await readdir(directory)).filter(name => name.endsWith('.md')).sort()) {
      const data = frontMatter(await readFile(join(directory, filename), 'utf8'));
      if (!data.ogImage) continue;
      cards.push({
        output: data.ogImage,
        title: data.title.replace(/\s+—\s+Lingua$/u, ''),
        subtitle: data.description,
        tag: data.language && data.language !== 'multi' ? data.language : '',
      });
    }
  }
  return cards;
}

const cards = [...Object.values(DEFAULTS), ...(await seoCards())];
const missing = cards.filter(card => !existsSync(join(publicDir, card.output)));

if (checkOnly) {
  if (missing.length > 0) {
    console.error(`generate-og-images: missing ${missing.map(card => card.output).join(', ')}`);
    process.exit(1);
  }
  console.log(`generate-og-images: ${cards.length} card(s) present`);
} else {
  const requireFromAstro = createRequire(import.meta.resolve('astro/package.json'));
  const sharp = requireFromAstro('sharp');
  for (const card of cards) {
    const target = join(publicDir, card.output);
    await mkdir(dirname(target), { recursive: true });
    const png = await sharp(Buffer.from(cardSvg(card))).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(target, png);
  }
  console.log(`generate-og-images: wrote ${cards.length} card(s)`);
}
