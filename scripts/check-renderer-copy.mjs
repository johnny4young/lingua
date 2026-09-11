import { readFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { lineAndColumn, parseSourceText } from './lib/estree.mjs';

const execFile = promisify(execFileCallback);
const COPY_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label']);
const SKIPPED_TAGS = new Set(['Kbd', 'code', 'pre']);
const ALLOWED_LITERALS = new Set(['Lingua']);

// Dev-only surfaces that carry no user-facing copy to translate.
// `src/renderer/devShowcase/**` is the Signal-Slate recipe gallery: it
// is dynamically imported only when the URL carries `?lingua-showcase`,
// so it code-splits into a lazy chunk that loads behind that param and
// is never reached in normal use (it is reviewed against the prod
// `preview:web` build). The "no hardcoded copy" rule guards shippable
// product copy, not internal demo scaffolding — mirroring the linter's
// `ignorePatterns` precedent for `dist/`, `out/`, and friends.
const EXCLUDED_PATH_SEGMENTS = [`${path.sep}src${path.sep}renderer${path.sep}devShowcase${path.sep}`];

function isExcludedPath(filePath) {
  return EXCLUDED_PATH_SEGMENTS.some((segment) => filePath.includes(segment));
}

function normalizeText(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function containsHumanCopy(value) {
  return /\p{L}{3}/u.test(normalizeText(value));
}

function isAllowedLiteral(value) {
  return ALLOWED_LITERALS.has(normalizeText(value));
}

function getJsxTagName(name) {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return name.property.name;
  if (name.type === 'JSXNamespacedName') return name.name.name;
  return '';
}

/**
 * A string the attribute carries directly — `title="Save"` or the
 * `title={'Save'}` / `title={`Save`}` spellings, which the TypeScript-based
 * version matched through `isStringLiteralLike`. An interpolated template
 * is not copy this guard can own, so it stays excluded.
 */
function literalAttributeText(value) {
  if (value == null) return '';
  if (value.type === 'Literal') return typeof value.value === 'string' ? value.value : '';
  if (value.type !== 'JSXExpressionContainer') return '';
  const expression = value.expression;
  if (expression.type === 'Literal') {
    return typeof expression.value === 'string' ? expression.value : '';
  }
  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? '';
  }
  return '';
}

export function findHardcodedCopyViolations(sourceText, filePath) {
  const program = parseSourceText(filePath, sourceText);
  const violations = [];

  // The TypeScript version walked UP through `node.parent` to find a
  // skipped ancestor, which needed `setParentNodes`. Carrying the answer
  // down the walk is the same predicate without the parent pointers.
  function visit(node, underSkippedTag) {
    if (node.type === 'JSXText') {
      const text = normalizeText(node.value);
      if (text && containsHumanCopy(text) && !isAllowedLiteral(text) && !underSkippedTag) {
        const { line, column } = lineAndColumn(sourceText, node.start);
        violations.push({
          filePath,
          line,
          column,
          text,
          reason: 'JSX text should resolve through i18n instead of embedding copy directly.',
        });
      }
    }

    if (node.type === 'JSXAttribute' && COPY_ATTRIBUTES.has(getJsxTagName(node.name))) {
      const text = literalAttributeText(node.value);

      if (text && containsHumanCopy(text) && !isAllowedLiteral(text)) {
        const { line, column } = lineAndColumn(sourceText, node.start);
        violations.push({
          filePath,
          line,
          column,
          text,
          reason: `Attribute "${node.name.text}" should use translated copy instead of a hardcoded string literal.`,
        });
      }
    }

    const nextSkipped =
      underSkippedTag ||
      (node.type === 'JSXElement' &&
        SKIPPED_TAGS.has(getJsxTagName(node.openingElement.name)));

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item !== null && typeof item === 'object' && typeof item.type === 'string') {
            visit(item, nextSkipped);
          }
        }
        continue;
      }
      if (child !== null && typeof child === 'object' && typeof child.type === 'string') {
        visit(child, nextSkipped);
      }
    }
  }

  visit(program, false);
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
    // diff-tree needs the same deletion-excluding filter as the two
    // diffs above: a commit that DELETES a renderer file otherwise
    // lists the dead path and the readFile below crashes with ENOENT
    // (first hit: the dead-code removal commit on 2026-06-10).
    [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      '-r',
      'HEAD',
      '--',
      'src/renderer',
    ],
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
    (filePath) =>
      filePath.includes(`${path.sep}src${path.sep}renderer${path.sep}`) &&
      /\.(ts|tsx)$/u.test(filePath) &&
      !isExcludedPath(filePath)
  );

  const violations = [];
  const readableFiles = [];

  for (const filePath of files) {
    let sourceText;
    try {
      sourceText = await readFile(filePath, 'utf8');
    } catch (error) {
      // A touched path can stop existing between enumeration and read
      // (deleted in the worktree, rename races). Skipping is correct:
      // a file that no longer ships cannot carry hardcoded copy. Any
      // other read failure still aborts the guard.
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    readableFiles.push(filePath);
    violations.push(...findHardcodedCopyViolations(sourceText, filePath));
  }

  return { files: readableFiles, violations };
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
