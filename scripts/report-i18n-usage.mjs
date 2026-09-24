#!/usr/bin/env node

/**
 * Advisory source-key inventory. It is deliberately not a deletion gate:
 * runtime-composed keys, remote payloads and indirect references may be
 * invisible even after the dynamic families below are accounted for.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { flattenMessages } from './check-i18n.mjs';
import { lineAndColumn, parseSourceText, walk } from './lib/estree.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'src');
const sourceLocale = path.join(repoRoot, 'src/renderer/i18n/locales/en/common.json');
const pluralSuffix = /_(?:zero|one|two|few|many|other)$/u;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function expressionParts(node) {
  if (!node || typeof node !== 'object') return [null];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral') {
    const parts = [];
    for (const [index, quasi] of node.quasis.entries()) {
      if (index > 0) parts.push(null);
      parts.push(quasi.value.cooked ?? quasi.value.raw);
    }
    return parts;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [...expressionParts(node.left), ...expressionParts(node.right)];
  }
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    return expressionParts(node.expression);
  }
  return [null];
}

function isTranslationCall(node) {
  if (node.type !== 'CallExpression') return false;
  if (node.callee.type === 'Identifier')
    return node.callee.name === 't' || node.callee.name === 'translate';
  return (
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 't'
  );
}

function dynamicPattern(parts) {
  if (!parts.includes(null) || !parts.some(part => typeof part === 'string' && part.length > 0)) {
    return null;
  }
  return new RegExp(
    `^${parts.map(part => (part === null ? '.*' : escapeRegExp(part))).join('')}$`,
    'u'
  );
}

/** Analyze explicit source text so dynamic-key fixtures can prove the report's limits. */
export function analyzeI18nUsage({ keys, sources }) {
  const literalReferences = new Set();
  const patterns = [];
  const unresolvedCalls = [];

  for (const { path: filePath, source } of sources) {
    const program = parseSourceText(filePath, source);
    walk(program, node => {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        literalReferences.add(node.value);
      }
      if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        literalReferences.add(node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw);
      }
      if (!isTranslationCall(node) || node.arguments.length === 0) return;
      const first = node.arguments[0];
      const parts = expressionParts(first);
      const pattern = dynamicPattern(parts);
      if (pattern) {
        patterns.push(pattern);
      } else if (parts.includes(null)) {
        unresolvedCalls.push({
          path: filePath,
          line: lineAndColumn(source, first.start).line,
          expression: source.slice(first.start, first.end),
        });
      }
    });
  }

  const directlyReferenced = [];
  const dynamicFamilyCovered = [];
  const pluralFamilyCovered = [];
  const possiblyUnused = [];
  for (const key of [...keys].sort()) {
    if (literalReferences.has(key)) directlyReferenced.push(key);
    else if (patterns.some(pattern => pattern.test(key))) dynamicFamilyCovered.push(key);
    else if (pluralSuffix.test(key)) {
      const base = key.replace(pluralSuffix, '');
      if (literalReferences.has(base) || patterns.some(pattern => pattern.test(base))) {
        pluralFamilyCovered.push(key);
      } else {
        possiblyUnused.push(key);
      }
    } else possiblyUnused.push(key);
  }
  return {
    directlyReferenced,
    dynamicFamilyCovered,
    pluralFamilyCovered,
    possiblyUnused,
    unresolvedCalls,
  };
}

async function sourceFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await sourceFiles(absolute, files);
    else if (
      entry.isFile() &&
      /\.(?:ts|tsx|mts)$/u.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(absolute);
    }
  }
  return files;
}

export async function reportProjectI18nUsage() {
  const locale = JSON.parse(await readFile(sourceLocale, 'utf8'));
  const keys = [...flattenMessages(locale).keys()];
  const sources = await Promise.all(
    (await sourceFiles(sourceRoot)).map(async absolute => ({
      path: path.relative(repoRoot, absolute).split(path.sep).join('/'),
      source: await readFile(absolute, 'utf8'),
    }))
  );
  return {
    ...analyzeI18nUsage({ keys, sources }),
    keyCount: keys.length,
    sourceFileCount: sources.length,
  };
}

async function main() {
  const report = await reportProjectI18nUsage();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `i18n usage advisory: ${report.keyCount} keys, ${report.sourceFileCount} source files`
  );
  console.log(
    `${report.directlyReferenced.length} literal, ${report.dynamicFamilyCovered.length} dynamic-family covered, ${report.pluralFamilyCovered.length} plural-family covered, ${report.possiblyUnused.length} possible unused, ${report.unresolvedCalls.length} unresolved translation calls.`
  );
  for (const key of report.possiblyUnused.slice(0, 30)) console.log(`  possible unused: ${key}`);
  if (report.possiblyUnused.length > 30)
    console.log(`  ... ${report.possiblyUnused.length - 30} more; use --json for the full list`);
  console.log('Advisory only: verify dynamic and indirect consumers before removing any key.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error(
      `i18n usage report failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
