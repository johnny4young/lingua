import { isLikelyTestFile, type ProjectTestCase } from '../../../shared/projectTests';
import { diffLines } from '../../utils/diff';

export interface CodeChange {
  /** Project-relative path of the changed file. */
  file: string;
  /** 1-based line of the first changed line in the working copy. */
  line: number;
  removed: string[];
  added: string[];
  /** Lines of the hunk left out of `removed` and `added`. */
  more: number;
}

export interface CodeChangeSources {
  /** Names in a project-relative directory ('' is the root), or null when it cannot be read. */
  listDirectory: (directory: string) => Promise<readonly { name: string; isDirectory: boolean }[] | null>;
  /** HEAD and working copy of a project-relative file. */
  diff: (file: string) => Promise<{ original: string; modified: string } | null>;
}

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/gu;
const MAX_FILES = 8;
const MAX_LINES = 3;

/** Relative module specifiers a JS/TS file imports, re-exports or requires, in source order. */
export function relativeImports(source: string): string[] {
  return [...new Set([...source.matchAll(IMPORT)].map(match => match[2]!))];
}

function joinPath(directory: string, specifier: string): string | null {
  const parts = directory === '' ? [] : directory.split('/');
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join('/');
}

const directoryOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

async function resolveImport(from: string, specifier: string, sources: CodeChangeSources, listings: Map<string, Promise<ReadonlySet<string> | null>>) {
  const target = joinPath(directoryOf(from), specifier);
  if (target === null || target === '') return null;
  const list = (directory: string) => {
    let entries = listings.get(directory);
    if (!entries) {
      entries = sources.listDirectory(directory).then(found => (found ? new Set(found.map(entry => (entry.isDirectory ? `${entry.name}/` : entry.name))) : null), () => null);
      listings.set(directory, entries);
    }
    return entries;
  };
  const directory = directoryOf(target);
  const base = target.slice(directory.length === 0 ? 0 : directory.length + 1);
  const names = await list(directory);
  if (!names) return null;
  // TypeScript ESM imports name the emitted `.js` file.
  const stem = base.replace(/\.(?:[cm]?js)$/u, '');
  const candidates = [base, ...EXTENSIONS.map(extension => `${stem}${extension}`)];
  const found = candidates.find(name => SCRIPT_FILE.test(name) && names.has(name));
  if (found) return directory ? `${directory}/${found}` : found;
  if (!names.has(`${base}/`)) return null;
  const inside = await list(target);
  const index = EXTENSIONS.map(extension => `index${extension}`).find(name => inside?.has(name));
  return index ? `${target}/${index}` : null;
}

/** The first changed block of a file: where it starts in the working copy and its lines. */
export function firstHunk(original: string, modified: string): Omit<CodeChange, 'file'> | null {
  const segments = diffLines(original, modified);
  let line = 1;
  let index = 0;
  while (index < segments.length && segments[index]!.kind === 'equal') {
    line += 1;
    index += 1;
  }
  if (index === segments.length) return null;
  const removed: string[] = [];
  const added: string[] = [];
  for (; index < segments.length && segments[index]!.kind !== 'equal'; index += 1) {
    const segment = segments[index]!;
    (segment.kind === 'remove' ? removed : added).push(segment.text.replace(/\r?\n$/u, ''));
  }
  const more = Math.max(0, removed.length - MAX_LINES) + Math.max(0, added.length - MAX_LINES);
  return { line, removed: removed.slice(0, MAX_LINES), added: added.slice(0, MAX_LINES), more };
}

/** Names called on the failing line, so `shipping(41.4)` points at `shipping.ts`. */
const calledNames = (line: string) => new Set([...line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/gu)].map(match => match[1]!.toLowerCase()));
const moduleName = (file: string) => file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, '').toLowerCase();

/**
 * The uncommitted change in the code a JS/TS test exercises: the modules it
 * imports, and theirs one level down, that differ from HEAD. A module named
 * after a function called on the failing line comes first. Untracked files
 * are not changes against HEAD, so they are left out.
 */
export async function findCodeUnderTestChange(
  input: { testFile: string; testSource: string; failingLine: string },
  sources: CodeChangeSources
): Promise<CodeChange | null> {
  if (!SCRIPT_FILE.test(input.testFile)) return null;
  const listings = new Map<string, Promise<ReadonlySet<string> | null>>();
  const visited = new Set<string>([input.testFile]);
  const changes: CodeChange[] = [];
  let frontier: { file: string; source: string }[] = [{ file: input.testFile, source: input.testSource }];
  for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
    // Each level resolves and diffs its imports together; source order still decides the fallback.
    const specifiers = frontier.flatMap(({ file, source }) => relativeImports(source).map(specifier => ({ file, specifier })));
    const resolved = await Promise.all(specifiers.map(({ file, specifier }) => resolveImport(file, specifier, sources, listings)));
    const files: string[] = [];
    for (const file of resolved) {
      if (!file || visited.has(file) || visited.size > MAX_FILES || file.split('/').includes('node_modules')) continue;
      visited.add(file);
      files.push(file);
    }
    const diffs = await Promise.all(files.map(file => sources.diff(file).catch(() => null)));
    const next: { file: string; source: string }[] = [];
    files.forEach((file, index) => {
      const diff = diffs[index];
      if (!diff || !diff.modified) return;
      next.push({ file, source: diff.modified });
      if (diff.original === '' || diff.original === diff.modified || isLikelyTestFile(file)) return;
      const hunk = firstHunk(diff.original, diff.modified);
      if (hunk) changes.push({ file, ...hunk });
    });
    frontier = next;
  }
  const called = calledNames(input.failingLine);
  return changes.find(change => called.has(moduleName(change.file))) ?? changes[0] ?? null;
}

/** The text Explain starts from: the runner's message and the change the test now runs against. */
export function explainTestFailureText(entry: Pick<ProjectTestCase, 'path' | 'failureMessage'>, change: CodeChange | null): string {
  const message = entry.failureMessage ?? entry.path.join(' › ');
  if (!change) return message;
  const lines = [...change.removed.map(line => `- ${line}`), ...change.added.map(line => `+ ${line}`)];
  return `${message}\n\nUncommitted change in ${change.file} at line ${change.line}:\n${lines.join('\n')}`;
}
