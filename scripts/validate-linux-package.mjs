#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { validateLinuxPackage } from './lib/linuxPackageValidation.mjs';

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      root: { type: 'string', default: 'out-builder' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/validate-linux-package.mjs [--root out-builder]');
    return 0;
  }
  const evidence = await validateLinuxPackage(values.root);
  console.log('linux-package: valid');
  console.log(JSON.stringify(evidence, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(`linux-package: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  );
}
