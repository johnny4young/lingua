#!/usr/bin/env node

import process from 'node:process';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { isDirectInvocation } from './lib/isDirectInvocation.mjs';
import { validateWindowsPackage } from './lib/windowsPackageValidation.mjs';

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      root: { type: 'string', default: 'out-builder' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/validate-windows-package.mjs [--root out-builder]');
    return 0;
  }

  const evidence = await validateWindowsPackage(values.root);
  console.log('windows-package: valid');
  console.log(JSON.stringify(evidence, null, 2));
  return 0;
}

if (isDirectInvocation(import.meta.url)) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(`windows-package: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  );
}
