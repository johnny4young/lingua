import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import generatedCatalog from '../src/data/cli-reference.json' with { type: 'json' };
import { CLI_HELP_CATALOG } from '../../src/cli/helpCatalog.ts';

const here = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(here, '..');

async function contentFiles(locale: 'en' | 'es') {
  const directory = resolve(websiteRoot, `src/content/cli/${locale}`);
  return (await readdir(directory)).filter(file => file.endsWith('.md')).sort();
}

test('generated CLI reference exactly matches the runtime help catalog', () => {
  assert.deepEqual(generatedCatalog, CLI_HELP_CATALOG);
});

test('English and Spanish CLI documentation have the same routes', async () => {
  assert.deepEqual(await contentFiles('en'), await contentFiles('es'));
  assert.deepEqual(await contentFiles('en'), [
    'automation.md',
    'capsules.md',
    'getting-started.md',
    'reference.md',
    'run-code.md',
    'troubleshooting.md',
    'utilities.md',
  ]);
});

test('both localized references cover every command and flag syntax', async () => {
  for (const locale of ['en', 'es'] as const) {
    const reference = (await readFile(resolve(websiteRoot, `src/content/cli/${locale}/reference.md`), 'utf8'))
      .replaceAll('\\|', '|')
      .replaceAll('`', '');
    for (const command of CLI_HELP_CATALOG.commands) {
      const commandPrefix = command.invocation.split(' [')[0]!;
      assert.ok(reference.includes(commandPrefix), `${locale} reference misses ${commandPrefix}`);
    }
    for (const flag of CLI_HELP_CATALOG.flags) {
      assert.ok(reference.includes(flag.syntax), `${locale} reference misses ${flag.syntax}`);
    }
  }
});

test('CLI search builds results with safe DOM operations and no network dependency', async () => {
  const client = await readFile(resolve(websiteRoot, 'public/scripts/site.js'), 'utf8');
  assert.match(client, /data-cli-search/);
  assert.match(client, /normalize\('NFD'\)/);
  assert.match(client, /textContent = item\.title/);
  assert.doesNotMatch(client, /fetch\([^)]*cli/i);
  assert.doesNotMatch(client, /innerHTML\s*=/);
});

test('CLI routes expose dedicated English and Spanish entry points', async () => {
  for (const route of [
    'src/pages/cli/index.astro',
    'src/pages/cli/[...slug].astro',
    'src/pages/es/cli/index.astro',
    'src/pages/es/cli/[...slug].astro',
  ]) {
    assert.match(await readFile(resolve(websiteRoot, route), 'utf8'), /<CliDoc/);
  }
});
