#!/usr/bin/env node
/**
 * Postbuild: scan dist/ for JSON-LD blocks, parse each, fail on malformed JSON
 * or missing required keys (@context, @type). Lightweight — not a full
 * schema.org validation, but catches the breakage that hides rich results.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const BLOCK_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
const REQUIRED = ['@context', '@type'];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

async function main() {
  let htmlFiles;
  try {
    htmlFiles = await walk(DIST);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[json-ld] dist/ not found, skipping');
      return;
    }
    throw err;
  }

  let blockCount = 0;
  const errors = [];

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    let m;
    while ((m = BLOCK_RE.exec(html)) !== null) {
      blockCount += 1;
      const raw = m[1].trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        errors.push(`${relative(DIST, file)}: invalid JSON — ${err.message}`);
        continue;
      }
      const docs = Array.isArray(parsed) ? parsed : [parsed];
      for (const doc of docs) {
        for (const key of REQUIRED) {
          if (!(key in doc)) {
            errors.push(`${relative(DIST, file)}: missing required key "${key}"`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[json-ld] ${errors.length} error(s) across ${blockCount} block(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[json-ld] ${blockCount} block(s) across ${htmlFiles.length} HTML file(s) — all valid.`);
}

main().catch((err) => {
  console.error('[json-ld] failed:', err);
  process.exit(1);
});
