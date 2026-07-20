#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
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

// Windows-safe main-module guard: a hand-built `file://${argv[1]}` never
// matches `import.meta.url` on Windows (drive letter + backslashes), which
// would make this validator silently no-op in the release workflow — the one
// platform it exists to protect. `pathToFileURL` normalises both sides.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
