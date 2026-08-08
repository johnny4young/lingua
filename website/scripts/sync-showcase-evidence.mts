#!/usr/bin/env node

/**
 * Owns the copy from deterministic Playwright evidence into the shipped
 * launch-story gallery, and records the digest of whatever ships.
 *
 * Why this is a script and not an assertion in the test suite: the evidence
 * lives in `output/playwright/**`, which is gitignored. It is absent on a fresh
 * clone and on every CI runner, so a test comparing against it is skipped
 * exactly where it would be load-bearing, and only ever fires on the one
 * machine that last ran the e2e suite. The two sides cannot agree across hosts
 * anyway: the shipped PNGs were rasterized by Chromium on macOS, and a Linux
 * runner produces different bytes for the same page. A machine-local check
 * belongs in a machine-local tool.
 *
 * The --check mode was removed once and reinstated. It shipped originally,
 * then measurement showed the captures were not byte-reproducible — a modal
 * entry fade captured at ~99% opacity shifted text pixels by one unit per
 * channel, and two surfaces render real measured durations — so a byte-exact
 * verifier would have failed on honest runs, teaching people to delete
 * output/ to silence it. The specs now screenshot with animations disabled,
 * pin measured durations (src/renderer/testing/e2eDurations.ts), wait for the
 * seeded workspace to settle, and park the pointer before capturing; the
 * residual Chromium edge-pixel rounding is absorbed by a strict tolerance in
 * this file. docs/DEVELOPMENT.md carries the full story.
 *
 * Modes:
 *   (default)   copy evidence over the shipped PNGs, then record their digests
 *   --check     compare shipped against evidence; writes nothing, exits 1 on drift
 *   --record    rewrite the integrity file from the shipped PNGs without copying
 *
 * `--record` exists because the gallery can legitimately be ahead of local
 * evidence — a colleague regenerated on their machine, or your own `output/`
 * is from an older run. Overwriting the gallery from stale evidence would be a
 * silent regression, so adopting the shipped bytes is a separate, explicit act.
 *
 * Refreshing the gallery:
 *   pnpm run test:e2e:web                          # regenerates output/playwright
 *   pnpm --dir website run sync:showcase-evidence  # copy + record
 *   # review the PNG diff, then commit the images and the integrity file
 *
 * The `sources` -> `images` mapping, including the rename each file gets on the
 * way in, is declared in src/data/v1-showcase.json. This script does not invent
 * paths; it reads them from there.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(websiteRoot, '..');
const showcasePath = resolve(websiteRoot, 'src/data/v1-showcase.json');
const integrityPath = resolve(websiteRoot, 'src/data/v1-showcase.integrity.json');

const LOCALES = ['en', 'es'] as const;

interface ShowcaseItem {
  id: string;
  spec: string;
  sources: Record<(typeof LOCALES)[number], string>;
  images: Record<(typeof LOCALES)[number], string>;
}

interface Fingerprint {
  bytes: number;
  sha256: string;
}

/**
 * pnpm 11 forwards the `--` separator itself into argv, so
 * `pnpm --dir website run sync:showcase-evidence -- --record` arrives here as
 * ['--', '--record'] and parseArgs rejects it as a positional. The repo hit
 * this before; scripts/lib/cli-args.mjs exists for it at the root. Kept inline
 * rather than imported so website/ scripts stay self-contained.
 */
function stripArgSeparator(args: string[]): string[] {
  return args.filter(arg => arg !== '--');
}

function parseOptions() {
  const { values } = parseArgs({
    args: stripArgSeparator(process.argv.slice(2)),
    options: {
      check: { type: 'boolean', default: false },
      record: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.check && values.record) {
    throw new Error('--check and --record are mutually exclusive: one verifies, the other rewrites.');
  }
  return values;
}

async function fingerprint(absolutePath: string): Promise<Fingerprint> {
  const bytes = await readFile(absolutePath);
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const describe = (print: Fingerprint | null) =>
  print ? `${print.bytes}B sha256:${print.sha256}` : '(missing)';

/**
 * Are two PNGs the same picture, allowing only rasterizer noise?
 *
 * Byte-exactness was the first goal, and four real nondeterminism sources were
 * eliminated at their roots to chase it (entry animations, measured durations,
 * the seeded welcome tab racing the capture, pointer hover state). What
 * remains after all of that is Chromium occasionally rounding a handful of
 * antialiased edge pixels one unit differently — measured at a single pixel
 * with a delta of one on a 1440x1000 capture, surviving pointer parking,
 * focus blur, and frame settling.
 *
 * A stale gallery — the thing this check exists to catch — differs by
 * thousands of pixels at full contrast. The thresholds below are three orders
 * of magnitude under that, so real drift cannot hide inside the tolerance,
 * and rasterizer noise cannot cry wolf.
 */
const TOLERANCE_MAX_PIXELS = 24;
const TOLERANCE_MAX_CHANNEL_DELTA = 2;

interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
}

/** Minimal PNG decode: 8-bit RGB/RGBA, no interlace — what page.screenshot emits. */
function decodePng(bytes: Buffer): DecodedPng {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.subarray(pos + 4, pos + 8).toString('latin1');
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(pos + 8);
      height = bytes.readUInt32BE(pos + 12);
      const bitDepth = bytes[pos + 16];
      const colorType = bytes[pos + 17];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported PNG shape (bitDepth=${bitDepth} colorType=${colorType})`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(pos + 8, pos + 8 + length));
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const line = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      if (filter === 1) line[i] = (line[i]! + left) & 255;
      else if (filter === 2) line[i] = (line[i]! + up) & 255;
      else if (filter === 3) line[i] = (line[i]! + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        line[i] = (line[i]! + predictor) & 255;
      }
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return { width, height, channels, pixels };
}

async function effectivelyIdentical(pathA: string, pathB: string): Promise<boolean> {
  const a = decodePng(await readFile(pathA));
  const b = decodePng(await readFile(pathB));
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return false;
  let differing = 0;
  for (let i = 0; i < a.pixels.length; i += a.channels) {
    let delta = 0;
    for (let c = 0; c < a.channels; c += 1) {
      delta = Math.max(delta, Math.abs(a.pixels[i + c]! - b.pixels[i + c]!));
    }
    if (delta === 0) continue;
    if (delta > TOLERANCE_MAX_CHANNEL_DELTA) return false;
    differing += 1;
    if (differing > TOLERANCE_MAX_PIXELS) return false;
  }
  return true;
}

/** Every `<item id>/<locale>` pair, flattened so both sides key the same way. */
function* entries(items: ShowcaseItem[]) {
  for (const item of items) {
    for (const locale of LOCALES) {
      yield {
        key: `${item.id}/${locale}`,
        spec: item.spec,
        evidence: resolve(repositoryRoot, item.sources[locale]),
        evidenceRelative: item.sources[locale],
        shipped: resolve(websiteRoot, 'public', item.images[locale].replace(/^\//u, '')),
        shippedRelative: `website/public${item.images[locale]}`,
      };
    }
  }
}

async function writeIntegrityFile(screenshots: Record<string, Fingerprint>): Promise<void> {
  const ordered = Object.fromEntries(Object.entries(screenshots).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(
    integrityPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        note:
          'sha256 of each shipped website/public/screenshots/v1.0 PNG. Regenerated by ' +
          'website/scripts/sync-showcase-evidence.mts, never by hand: a digest edited to match ' +
          'a stale image turns this lock into a rubber stamp. tests/v1LaunchStory.test.mts ' +
          'asserts these, which is what makes the check run on a fresh clone and in CI, where ' +
          'output/playwright is absent and the evidence comparison cannot run at all.',
        screenshots: ordered,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

async function main(): Promise<number> {
  const { check, record } = parseOptions();
  const showcase = JSON.parse(await readFile(showcasePath, 'utf8')) as { items: ShowcaseItem[] };
  const all = [...entries(showcase.items)];

  if (record) {
    const screenshots: Record<string, Fingerprint> = {};
    const missing: string[] = [];
    for (const entry of all) {
      if (!existsSync(entry.shipped)) {
        missing.push(`${entry.key} (${entry.shippedRelative})`);
        continue;
      }
      screenshots[entry.key] = await fingerprint(entry.shipped);
    }
    if (missing.length > 0) {
      console.error(`sync-showcase-evidence: shipped screenshot(s) missing:\n  ${missing.join('\n  ')}`);
      return 1;
    }
    await writeIntegrityFile(screenshots);
    console.log(`sync-showcase-evidence: recorded ${Object.keys(screenshots).length} shipped digest(s)`);
    return 0;
  }

  const withoutEvidence = all.filter(entry => !existsSync(entry.evidence));
  if (withoutEvidence.length === all.length) {
    if (check) {
      // Nothing to verify is not a failure. This comparison is local by
      // construction — output/playwright is gitignored, so a fresh clone and
      // every CI runner have nothing to compare against. The portable half of
      // the guarantee lives in tests/v1LaunchStory.test.mts, which asserts the
      // recorded digests and needs no evidence at all.
      console.log('sync-showcase-evidence: no local evidence under output/playwright, nothing to verify');
      return 0;
    }
    console.error(
      'sync-showcase-evidence: no evidence found under output/playwright.\n' +
        'Run "pnpm run test:e2e:web" from the repository root first; it regenerates every capture.\n' +
        'To adopt the currently shipped gallery instead, use --record.'
    );
    return 1;
  }
  if (withoutEvidence.length > 0) {
    console.log(
      `sync-showcase-evidence: no local evidence for ${withoutEvidence.length} of ${all.length}, left untouched:\n  ` +
        withoutEvidence.map(entry => `${entry.key} (${entry.evidenceRelative}, from ${entry.spec})`).join('\n  ')
    );
  }

  const present = all.filter(entry => existsSync(entry.evidence));

  if (check) {
    const drifted: string[] = [];
    let withinTolerance = 0;
    for (const entry of present) {
      const evidence = await fingerprint(entry.evidence);
      const shipped = existsSync(entry.shipped) ? await fingerprint(entry.shipped) : null;
      if (shipped?.sha256 === evidence.sha256) continue;
      if (shipped && (await effectivelyIdentical(entry.shipped, entry.evidence))) {
        withinTolerance += 1;
        continue;
      }
      drifted.push(
        `${entry.key}\n` +
          `      shipped  ${describe(shipped)}  ${entry.shippedRelative}\n` +
          `      evidence ${describe(evidence)}  ${entry.evidenceRelative}`
      );
    }
    if (drifted.length > 0) {
      console.error(
        `sync-showcase-evidence: ${drifted.length} of ${present.length} shipped screenshot(s) differ from local evidence:\n  ` +
          drifted.join('\n  ') +
          '\n\nEither the gallery is stale (re-run without --check to refresh it), or your local\n' +
          'evidence predates what shipped. Compare mtimes before overwriting anything.'
      );
      return 1;
    }
    const toleranceNote = withinTolerance > 0 ? ` (${withinTolerance} within raster tolerance)` : '';
    console.log(
      `sync-showcase-evidence: ok (${present.length} of ${all.length} match local evidence${toleranceNote})`
    );
    return 0;
  }

  for (const entry of present) {
    // The v1.0/ directory exists today, but the next gallery version will not
    // until something creates it — and a copyFile into a missing directory
    // throws rather than creating the path.
    await mkdir(dirname(entry.shipped), { recursive: true });
    await copyFile(entry.evidence, entry.shipped);
  }
  // Digest the SHIPPED file, not the evidence: after the copy they are equal,
  // and for anything left untouched above this keeps the record describing what
  // is actually in website/public rather than what some other machine has.
  const screenshots: Record<string, Fingerprint> = {};
  for (const entry of all) {
    if (existsSync(entry.shipped)) screenshots[entry.key] = await fingerprint(entry.shipped);
  }
  await writeIntegrityFile(screenshots);
  console.log(
    `sync-showcase-evidence: copied ${present.length} of ${all.length} and recorded ${Object.keys(screenshots).length} digest(s)`
  );
  return 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
);
