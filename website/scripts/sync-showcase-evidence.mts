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
 * There is deliberately NO mode that verifies the gallery against local
 * evidence. I measured it before writing one: running
 * tests/e2e/projectTestsVisual.spec.ts nine times in a row produced an
 * identical EN capture every time, but the ES capture alternated between two
 * stable states 87758B and 89584B apart, the minority state in 2 of 9 runs. A
 * byte-exact verifier would therefore fail on roughly a fifth of honest runs,
 * and a check that cries wolf that often teaches people to delete output/ to
 * silence it — which is precisely the rot this file exists to end. Reinstate
 * such a mode once the captures are actually deterministic.
 *
 * Modes:
 *   (default)   copy evidence over the shipped PNGs, then record their digests
 *   --record    rewrite the integrity file from the shipped PNGs without copying
 *
 * `--record` exists because the gallery can legitimately be ahead of local
 * evidence — a colleague regenerated on their machine, or your own `output/`
 * is from an older run. Overwriting the gallery from stale evidence would be a
 * silent regression, so adopting the shipped bytes is a separate, explicit act.
 *
 * Refreshing the gallery:
 *   pnpm run test:e2e:web                            # regenerates output/playwright
 *   npm --prefix website run sync:showcase-evidence  # copy + record
 *   # review the PNG diff, then commit the images and the integrity file
 *
 * The `sources` -> `images` mapping, including the rename each file gets on the
 * way in, is declared in src/data/v1-showcase.json. This script does not invent
 * paths; it reads them from there.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

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
 * `pnpm --dir website run check:showcase-evidence -- --record` arrives here as
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
      record: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return values;
}

async function fingerprint(absolutePath: string): Promise<Fingerprint> {
  const bytes = await readFile(absolutePath);
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
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
  const { record } = parseOptions();
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

  for (const entry of present) {
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
