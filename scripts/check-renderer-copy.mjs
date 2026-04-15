import { readFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const execFile = promisify(execFileCallback);
const COPY_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label']);
const SKIPPED_TAGS = new Set(['Kbd', 'code', 'pre']);
const ALLOWED_LITERALS = new Set(['Lingua']);

function normalizeText(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function containsHumanCopy(value) {
  return /\p{L}{3}/u.test(normalizeText(value));
}

function isAllowedLiteral(value) {
  return ALLOWED_LITERALS.has(normalizeText(value));
}

function getLineAndColumn(sourceFile, pos) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: line + 1, column: character + 1 };
}

function getJsxTagName(tagName) {
  if (ts.isIdentifier(tagName)) return tagName.text;
  if (ts.isPropertyAccessExpression(tagName)) return tagName.name.text;
  return tagName.getText();
}

function isUnderSkippedTag(node) {
  let current = node.parent;

  while (current) {
    if (ts.isJsxElement(current)) {
      if (SKIPPED_TAGS.has(getJsxTagName(current.openingElement.tagName))) return true;
    }

    if (ts.isJsxSelfClosingElement(current)) {
      if (SKIPPED_TAGS.has(getJsxTagName(current.tagName))) return true;
    }

    current = current.parent;
  }

  return false;
}

export function findHardcodedCopyViolations(sourceText, filePath) {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const violations = [];

  function visit(node) {
    if (ts.isJsxText(node)) {
      const text = normalizeText(node.getText(sourceFile));
      if (text && containsHumanCopy(text) && !isAllowedLiteral(text) && !isUnderSkippedTag(node)) {
        const { line, column } = getLineAndColumn(sourceFile, node.getStart(sourceFile));
        violations.push({
          filePath,
          line,
          column,
          text,
          reason: 'JSX text should resolve through i18n instead of embedding copy directly.',
        });
      }
    }

    if (ts.isJsxAttribute(node) && COPY_ATTRIBUTES.has(node.name.text)) {
      const initializer = node.initializer;
      let text = '';

      if (initializer && ts.isStringLiteral(initializer)) {
        text = initializer.text;
      } else if (
        initializer &&
        ts.isJsxExpression(initializer) &&
        initializer.expression &&
        ts.isStringLiteralLike(initializer.expression)
      ) {
        text = initializer.expression.text;
      }

      if (text && containsHumanCopy(text) && !isAllowedLiteral(text)) {
        const { line, column } = getLineAndColumn(sourceFile, node.getStart(sourceFile));
        violations.push({
          filePath,
          line,
          column,
          text,
          reason: `Attribute "${node.name.text}" should use translated copy instead of a hardcoded string literal.`,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

async function git(args) {
  try {
    const { stdout } = await execFile('git', args, { cwd: process.cwd() });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function listTouchedRendererFiles(args) {
  if (args.length > 0) {
    return args.map((file) => path.resolve(file));
  }

  const touched = new Set();
  const baseRef = process.env.GITHUB_BASE_REF;

  if (baseRef) {
    const mergeBase = await git(['merge-base', `origin/${baseRef}`, 'HEAD']);
    if (mergeBase) {
      const changed = await git([
        'diff',
        '--name-only',
        '--diff-filter=ACMRTUXB',
        `${mergeBase}...HEAD`,
        '--',
        'src/renderer',
      ]);
      for (const file of changed.split('\n').filter(Boolean)) {
        touched.add(path.resolve(file));
      }
    }
  }

  for (const argsSet of [
    ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--', 'src/renderer'],
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB', '--', 'src/renderer'],
    ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD', '--', 'src/renderer'],
  ]) {
    const changed = await git(argsSet);
    for (const file of changed.split('\n').filter(Boolean)) {
      touched.add(path.resolve(file));
    }
  }

  return [...touched];
}

export async function checkRendererCopy(fileArgs = []) {
  const files = (await listTouchedRendererFiles(fileArgs)).filter(
    (filePath) => filePath.includes(`${path.sep}src${path.sep}renderer${path.sep}`) && /\.(ts|tsx)$/u.test(filePath)
  );

  const violations = [];

  for (const filePath of files) {
    const sourceText = await readFile(filePath, 'utf8');
    violations.push(...findHardcodedCopyViolations(sourceText, filePath));
  }

  return { files, violations };
}

async function main() {
  try {
    const result = await checkRendererCopy(process.argv.slice(2));

    if (result.files.length === 0) {
      console.log('Renderer copy guard found no touched renderer files to inspect.');
      return;
    }

    if (result.violations.length > 0) {
      console.error('Renderer copy guard found hardcoded user-facing strings:');
      for (const violation of result.violations) {
        console.error(
          `- ${path.relative(process.cwd(), violation.filePath)}:${violation.line}:${violation.column} "${violation.text}"\n  ${violation.reason}`
        );
      }
      process.exitCode = 1;
      return;
    }

    console.log(`Renderer copy guard passed for ${result.files.length} touched file(s).`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Renderer copy guard failed: ${detail}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
