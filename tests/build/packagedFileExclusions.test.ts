import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

// The matcher electron-builder applies to files patterns, not the older one at the repo root.
const builderRequire = createRequire(createRequire(import.meta.url).resolve('app-builder-lib/package.json'));
const { minimatch } = builderRequire('minimatch') as {
  minimatch: (path: string, pattern: string, options: { dot: boolean }) => boolean;
};

const builder = load(readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8')) as {
  files?: string[];
};
const exclusions = (builder.files ?? []).filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));
const excluded = (file: string) => exclusions.some(pattern => minimatch(file, pattern, { dot: true }));

describe('packaged dependency files', () => {
  it.each([
    'node_modules/pg/lib/client.js.map',
    'node_modules/@modelcontextprotocol/server/dist/index.d.mts',
    'node_modules/zod/src/v4/core/schemas.ts',
    'node_modules/tedious/lib/connection.d.cts',
    'node_modules/mysql2/lib/README.md',
  ])('leaves %s out of app.asar', file => {
    expect(excluded(file)).toBe(true);
  });

  it.each([
    'node_modules/pg/lib/client.js',
    'node_modules/zod/v4/core/schemas.cjs',
    'node_modules/ssh2/LICENSE.md',
    'node_modules/node-pty/build/Release/pty.node',
    '.vite/build/main.js',
  ])('keeps %s', file => {
    expect(excluded(file)).toBe(false);
  });
});
