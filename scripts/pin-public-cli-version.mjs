#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { isDirectInvocation } from './lib/isDirectInvocation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Website pages whose copy-ready examples pin the public npm CLI version. */
export const PINNED_CLI_FILES = [
  'website/src/content/cli/en/recipes.md',
  'website/src/content/cli/es/recipes.md',
];

/** Rewrite the package.json and `npm install` pins of @linguacode/cli to `version`. */
export function pinCliVersion(text, version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`Invalid version "${version}".`);
  let pins = 0;
  const next = text
    .replace(/("@linguacode\/cli": ")\d+\.\d+\.\d+(")/gu, (_, open, close) => {
      pins += 1;
      return `${open}${version}${close}`;
    })
    .replace(/(@linguacode\/cli@)\d+\.\d+\.\d+/gu, (_, prefix) => {
      pins += 1;
      return `${prefix}${version}`;
    });
  return { text: next, pins };
}

function main() {
  const { values } = parseArgs({
    args: stripArgSeparator(process.argv.slice(2)),
    options: { version: { type: 'string' } },
  });
  const version = values.version?.replace(/^v/u, '') ?? '';
  for (const relative of PINNED_CLI_FILES) {
    const file = path.join(repoRoot, relative);
    const { text, pins } = pinCliVersion(readFileSync(file, 'utf8'), version);
    if (pins === 0) throw new Error(`${relative} has no @linguacode/cli pin to update.`);
    writeFileSync(file, text);
    console.log(`pin-public-cli-version: ${relative} → ${version} (${pins} pins)`);
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`pin-public-cli-version: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
