#!/usr/bin/env node
/**
 * Draws the Lingua mark and wordmark from scripts/brand/glyph-outlines.json and
 * writes every icon the app, the web build and the website ship.
 *
 *   node scripts/brand/generate-brand-assets.mjs          # write SVGs and rasters
 *   node scripts/brand/generate-brand-assets.mjs --check  # exit 1 when an SVG drifted
 *
 * Construction and minimum sizes: assets/brand/README.md.
 */

import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectInvocation } from '../lib/isDirectInvocation.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outlines = JSON.parse(readFileSync(join(repo, 'scripts/brand/glyph-outlines.json'), 'utf8'));

export const BRAND = {
  pulse: '#00BFDF',
  ink: '#0E1517',
  paper: '#F3F7F8',
  leader: '#5E7377',
  groundFrom: '#16292D',
  groundTo: '#04090A',
};

/** Corner radius per platform on the 160-unit grid. */
export const RADIUS = { mac: 36, windows: 9.6, web: 28.8, maskable: 0 };

/** At this size and below the leader is dropped: the l and a larger pulse only. */
export const LITE_MAX_PX = 32;

const GRID = 160;
const MASTER = { l: { x: 32, y: 122, size: 120 }, leader: [80, 93, 106], pulse: { cx: 132, cy: 113, r: 11 } };
const LITE = { l: { x: 40, y: 126, size: 132 }, pulse: { cx: 118, cy: 112, r: 17 } };
const DOT_EM = 0.175;
const DOT_RISE_EM = 0.05;
const TRACKING_EM = -0.01;

const round = value => Number(value.toFixed(2));

/** Maps a font-unit outline (y up, absolute M/L/Q/C/Z) to SVG space at a baseline origin. */
export function placeOutline(d, { x, y, size }) {
  const k = size / outlines.unitsPerEm;
  let axis = 0;
  return d.replace(/-?\d+(?:\.\d+)?/gu, number => {
    const value = Number(number);
    const placed = axis === 0 ? x + value * k : y - value * k;
    axis = 1 - axis;
    return String(round(placed));
  });
}

function circle(cx, cy, r, fill) {
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${fill}"/>`;
}

/** The mark on its 160-unit grid: the l, the dot leader and the pulse; lite drops the leader. */
export function markShapes({ lite = false, glyphFill = BRAND.paper, leaderFill = BRAND.leader, pulseFill = BRAND.pulse } = {}) {
  if (lite) {
    return [
      `<path d="${placeOutline(outlines.liteL.d, LITE.l)}" fill="${glyphFill}"/>`,
      circle(LITE.pulse.cx, LITE.pulse.cy, LITE.pulse.r, pulseFill),
    ];
  }
  return [
    `<path d="${placeOutline(outlines.markL.d, MASTER.l)}" fill="${glyphFill}"/>`,
    ...MASTER.leader.map(cx => circle(cx, MASTER.pulse.cy, 2.6, leaderFill)),
    circle(MASTER.pulse.cx, MASTER.pulse.cy, MASTER.pulse.r, pulseFill),
  ];
}

/** App icon: the Ink ground plus the mark. Maskable keeps the mark inside the 80 % safe circle. */
export function appIconSvg({ radius, px = 1024, maskable = false }) {
  const shapes = markShapes({ lite: px <= LITE_MAX_PX }).join('\n    ');
  const body = maskable ? `<g transform="translate(16 16) scale(0.8)">\n    ${shapes}\n  </g>` : shapes;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${px}" height="${px}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.groundFrom}"/>
      <stop offset="1" stop-color="${BRAND.groundTo}"/>
    </linearGradient>
  </defs>
  <rect width="${GRID}" height="${GRID}" rx="${radius}" fill="url(#ground)"/>
  ${body}
</svg>
`;
}

/** One-colour mark without a ground, for tray templates, print and watermarks. */
export function markMonoSvg() {
  const shapes = markShapes({ glyphFill: 'currentColor', leaderFill: 'currentColor', pulseFill: 'currentColor' });
  const glyph = pathBounds(placeOutline(outlines.markL.d, MASTER.l));
  const { cx, cy, r } = MASTER.pulse;
  const x = Math.floor(glyph.minX);
  const y = Math.floor(glyph.minY);
  const width = Math.ceil(cx + r - x);
  const height = Math.ceil(Math.max(glyph.maxY, cy + r) - y);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">
  ${shapes.join('\n  ')}
</svg>
`;
}

function quadExtrema(p0, p1, p2) {
  const denominator = p0 - 2 * p1 + p2;
  if (denominator === 0) return [];
  const t = (p0 - p1) / denominator;
  return t > 0 && t < 1 ? [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2] : [];
}

function cubicExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots = [];
  if (Math.abs(a) < 1e-9) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) roots.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a));
  }
  return roots
    .filter(t => t > 0 && t < 1)
    .map(t => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3);
}

/** Exact bounds of an absolute M/L/Q/C/Z path. */
export function pathBounds(d) {
  const xs = [];
  const ys = [];
  let current = [0, 0];
  for (const [, command, args] of d.matchAll(/([MLQCZ])([^MLQCZ]*)/gu)) {
    const n = args.trim() ? args.trim().split(/\s+/u).map(Number) : [];
    const points = [];
    for (let i = 0; i < n.length; i += 2) points.push([n[i], n[i + 1]]);
    if (command === 'Z') continue;
    const end = points.at(-1);
    xs.push(end[0]);
    ys.push(end[1]);
    if (command === 'Q') {
      xs.push(...quadExtrema(current[0], points[0][0], end[0]));
      ys.push(...quadExtrema(current[1], points[0][1], end[1]));
    } else if (command === 'C') {
      xs.push(...cubicExtrema(current[0], points[0][0], points[1][0], end[0]));
      ys.push(...cubicExtrema(current[1], points[0][1], points[1][1], end[1]));
    }
    current = end;
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** The wordmark letterforms and drawn dot at a 100-unit em, baseline at y = 0. */
export function wordmarkGeometry() {
  const size = 100;
  const { wordmark, unitsPerEm } = outlines;
  const d = placeOutline(wordmark.d, { x: 0, y: 0, size });
  const k = size / unitsPerEm;
  const dotR = (DOT_EM * size) / 2;
  // The board sets the dot half the dotless advance in, then 0.15 em right for the italic.
  const dotCx = (wordmark.dotlessX + (wordmark.dotlessAdvance + TRACKING_EM * unitsPerEm) / 2) * k + 0.15 * size + dotR;
  const dotCy = -(wordmark.xHeight * k + DOT_RISE_EM * size + dotR);
  const glyphs = pathBounds(d);
  const bounds = {
    minX: Math.min(glyphs.minX, dotCx - dotR),
    minY: Math.min(glyphs.minY, dotCy - dotR),
    maxX: Math.max(glyphs.maxX, dotCx + dotR),
    maxY: Math.max(glyphs.maxY, dotCy + dotR),
  };
  return { d, dot: { cx: dotCx, cy: dotCy, r: dotR }, bounds, xHeight: wordmark.xHeight * k };
}

/** Outlined wordmark, viewBox tight to the letterforms; clear space is documented, not baked in. */
export function wordmarkSvg({ letters, dot }) {
  const { d, dot: geometry, bounds } = wordmarkGeometry();
  const x = round(bounds.minX);
  const y = round(bounds.minY);
  const width = round(bounds.maxX - bounds.minX);
  const height = round(bounds.maxY - bounds.minY);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${Math.round(width * 2)}" height="${Math.round(height * 2)}">
  <title>lingua</title>
  <path d="${d}" fill="${letters}"/>
  ${circle(geometry.cx, geometry.cy, geometry.r, dot)}
</svg>
`;
}

export function svgOutputs() {
  const favicon = appIconSvg({ radius: RADIUS.web, px: 32 });
  const inverse = wordmarkSvg({ letters: BRAND.paper, dot: BRAND.pulse });
  return {
    'assets/icon.svg': appIconSvg({ radius: RADIUS.mac }),
    'assets/brand/wordmark.svg': wordmarkSvg({ letters: BRAND.ink, dot: BRAND.pulse }),
    'assets/brand/wordmark-inverse.svg': inverse,
    'assets/brand/wordmark-mono.svg': wordmarkSvg({ letters: 'currentColor', dot: 'currentColor' }),
    'assets/brand/mark-mono.svg': markMonoSvg(),
    'public/favicon.svg': favicon,
    'website/public/favicon.svg': favicon,
    'website/scripts/og-wordmark.svg': inverse,
  };
}

/** PNG rasters, one SVG per pixel size so the lite mark takes over at 32 px. */
function rasters() {
  return {
    'assets/icon.png': appIconSvg({ radius: RADIUS.web, px: 1024 }),
    'public/icon-192.png': appIconSvg({ radius: RADIUS.web, px: 192 }),
    'public/icon-512.png': appIconSvg({ radius: RADIUS.web, px: 512 }),
    'public/icon-maskable-512.png': appIconSvg({ radius: RADIUS.maskable, px: 512, maskable: true }),
  };
}

/** ICNS PNG slots for 16-512 pt at 1x and @2x, as iconutil names them. */
export const ICNS_TYPES = [
  ['icp4', 16],
  ['ic11', 32],
  ['icp5', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
];

export const ICO_SIZES = [16, 24, 32, 48, 64, 256];

export function encodeIcns(entries) {
  const chunks = entries.map(([type, png]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'latin1');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

export function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const directory = entries.map(([px, png]) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(px >= 256 ? 0 : px, 0);
    entry.writeUInt8(px >= 256 ? 0 : px, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...directory, ...entries.map(([, png]) => png)]);
}

async function rasterize(sharp, svg) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

async function writeAll() {
  const { default: sharp } = await import('sharp');
  const write = async (relative, content) => {
    const target = join(repo, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  for (const [relative, svg] of Object.entries(svgOutputs())) await write(relative, svg);
  for (const [relative, svg] of Object.entries(rasters())) await write(relative, await rasterize(sharp, svg));
  const cache = new Map();
  const png = async (radius, px) => {
    const key = `${radius}:${px}`;
    if (!cache.has(key)) cache.set(key, await rasterize(sharp, appIconSvg({ radius, px })));
    return cache.get(key);
  };
  const icns = [];
  for (const [type, px] of ICNS_TYPES) icns.push([type, await png(RADIUS.mac, px)]);
  await write('assets/icon.icns', encodeIcns(icns));
  const ico = [];
  for (const px of ICO_SIZES) ico.push([px, await png(RADIUS.windows, px)]);
  await write('assets/icon.ico', encodeIco(ico));
}

export async function driftedSvgs() {
  const entries = Object.entries(svgOutputs());
  const current = await Promise.all(entries.map(([relative]) => readFile(join(repo, relative), 'utf8').catch(() => null)));
  return entries.filter(([, svg], index) => current[index] !== svg).map(([relative]) => relative);
}

if (isDirectInvocation(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const drifted = await driftedSvgs();
    if (drifted.length > 0) {
      console.error(`generate-brand-assets: out of date: ${drifted.join(', ')}`);
      process.exit(1);
    }
    console.log('generate-brand-assets: SVGs match the generator');
  } else {
    await writeAll();
    console.log('generate-brand-assets: wrote SVGs, PNGs, icon.icns and icon.ico');
  }
}
