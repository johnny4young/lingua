import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { isRegressionTarget } from '../../shared/capsuleRegressionSuite';
import { ExecutionTargetError } from './targets';

const extensions: Record<string, readonly string[]> = {
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts', '.mts', '.cts'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  ruby: ['.rb'],
  lua: ['.lua'],
};
export class RegressionTargetError extends Error {}
export async function resolveRegressionTarget(
  root: string,
  target: string,
  language: string
): Promise<string> {
  if (!isRegressionTarget(target))
    throw new RegressionTargetError('Target must be a relative path without traversal.');
  const base = await realpath(root).catch(() => {
    throw new RegressionTargetError('Could not resolve the suite root.');
  });
  const candidate = path.resolve(base, target.replaceAll('\\', '/'));
  const actual = await realpath(candidate).catch(() => {
    throw new RegressionTargetError('Target was not found or could not be read.');
  });
  const relative = path.relative(base, actual);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new RegressionTargetError('Target escapes the authorized suite root.');
  if (
    !(await stat(actual)).isFile() ||
    !extensions[language]?.includes(path.extname(actual).toLowerCase())
  )
    throw new ExecutionTargetError(
      'unsupported-file-type',
      'Target must be a regular file compatible with the baseline language.'
    );
  return actual;
}
/** Enforce the byte limit while consuming, including files changed after stat. */
export async function readBoundedSuite(file: string, limit: number): Promise<string> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('suite-too-large');
    chunks.push(chunk);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
