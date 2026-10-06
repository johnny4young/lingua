#!/usr/bin/env node
/* global process */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

if (process.argv[2] === '--version') {
  process.stdout.write('rustc 0.0.0-lingua-fixture\n');
  process.exit(0);
}
const outputIndex = process.argv.indexOf('-o');
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!outputPath) process.exit(2);
const sourcePath = process.argv.find(argument => argument.endsWith('.rs'));
const sourceText = sourcePath ? readFileSync(sourcePath, 'utf8') : '';
if (sourceText.includes('compile_error!("flood")')) {
  // Multibyte diagnostics past the 1 MiB cap on BOTH pipes, so the joined
  // compile output exceeds the budget even after each pipe is clipped.
  const text = '漢😀'.repeat(160_000);
  process.stdout.write(text, () => {
    process.stderr.write(text, () => process.exit(1));
  });
} else if (sourceText.includes('compile_error!')) {
  process.stderr.write('error: fixture compile failure\n --> main.rs:1:1\n');
  process.exit(1);
} else {
  writeFileSync(outputPath, '#!/bin/sh\necho result 2\n', 'utf8');
  chmodSync(outputPath, 0o755);
}
