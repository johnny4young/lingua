#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_HELP_CATALOG } from '../../src/cli/helpCatalog.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../src/data/cli-reference.json');
const expected = `${JSON.stringify(CLI_HELP_CATALOG, null, 2)}\n`;
const check = process.argv.includes('--check');

let current: string | null = null;
try {
  current = await readFile(outputPath, 'utf8');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

if (current === expected) {
  console.log('[cli-reference] up to date');
} else if (check) {
  console.error('[cli-reference] drift detected; run npm run sync:cli-reference');
  process.exitCode = 1;
} else {
  await writeFile(outputPath, expected, 'utf8');
  console.log('[cli-reference] updated src/data/cli-reference.json');
}
