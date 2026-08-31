import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import rootPackage from '../../package.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(here, '..');
const spanishVoseoPattern =
  /(?<![\p{L}\p{N}_])(?:instalá|invocá|pedile|podés|querés|verificá|ejecutá)(?![\p{L}\p{N}_])/iu;

async function agentGuide(locale: 'en' | 'es') {
  return readFile(resolve(websiteRoot, `src/content/cli/${locale}/ai-agents.md`), 'utf8');
}

function frontmatterValue(markdown: string, field: string): string {
  const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(markdown)?.[1] ?? '';
  const value = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'mu'))?.[1];
  assert.ok(value, `missing ${field} frontmatter`);
  return value;
}

function tableContainsCode(markdown: string, value: string): boolean {
  return markdown
    .split('\n')
    .some(line => line.split('|').some(cell => cell.trim() === `\`${value}\``));
}

test('agent guides keep matching localized routes and current version metadata', async () => {
  const [english, spanish] = await Promise.all([agentGuide('en'), agentGuide('es')]);

  for (const guide of [english, spanish]) {
    assert.equal(frontmatterValue(guide, 'order'), '45');
    assert.equal(frontmatterValue(guide, 'group'), 'automation');
    assert.ok(frontmatterValue(guide, 'description').length <= 180);
    assert.match(guide, new RegExp(`CLI ${rootPackage.version.replaceAll('.', '\\.')}`));
    assert.match(guide, /skills\/lingua-verify/u);
    assert.match(guide, /plugin\.json/u);
  }

  const englishHeadingLevels = [...english.matchAll(/^(#{2,3})\s+/gmu)].map(match => match[1]);
  const spanishHeadingLevels = [...spanish.matchAll(/^(#{2,3})\s+/gmu)].map(match => match[1]);
  assert.deepEqual(spanishHeadingLevels, englishHeadingLevels);
  assert.match(english, /^### Codex$/mu);
  assert.match(spanish, /^### Codex$/mu);
  assert.doesNotMatch(`${english}\n${spanish}`, /^### ChatGPT/mu);
});

test('agent guides expose the same bounded CLI workflow', async () => {
  for (const locale of ['en', 'es'] as const) {
    const guide = await agentGuide(locale);
    for (const command of [
      'lingua --version',
      'lingua run',
      'lingua capsule validate',
      'lingua capsule replay',
      'lingua list utilities',
      'lingua utility',
      '--json',
      '--env',
    ]) {
      assert.ok(guide.includes(command), `${locale} agent guide misses ${command}`);
    }
    for (const code of ['0', '1', '2', '3', '4']) {
      assert.ok(tableContainsCode(guide, code), `${locale} agent guide misses exit ${code}`);
    }
  }
});

test('agent guides state the execution and MCP boundaries in both languages', async () => {
  const [english, spanish] = await Promise.all([agentGuide('en'), agentGuide('es')]);

  for (const phrase of [
    'not an OS sandbox',
    'Do not let an agent install Lingua',
    'Do not forward secrets through `--env`',
    'read-only option',
  ]) {
    assert.ok(english.includes(phrase), `English agent guide misses ${phrase}`);
  }
  for (const phrase of [
    'no es un sandbox',
    'No permitas que un agente instale Lingua',
    'No envíes secretos mediante `--env`',
    'opción de solo lectura',
  ]) {
    assert.ok(spanish.includes(phrase), `Spanish agent guide misses ${phrase}`);
  }

  assert.doesNotMatch(spanish, spanishVoseoPattern);
});

test('Spanish copy guard recognizes every listed voseo form', () => {
  for (const word of ['instalá', 'invocá', 'pedile', 'podés', 'querés', 'verificá', 'ejecutá']) {
    assert.match(word, spanishVoseoPattern, `copy guard misses ${word}`);
  }
});
