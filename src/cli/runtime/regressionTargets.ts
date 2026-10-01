import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { isRegressionTarget } from '../../shared/capsuleRegressionSuite';
import { CLI_SOURCE_EXTENSIONS } from './targets';

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
    !CLI_SOURCE_EXTENSIONS[language]?.includes(path.extname(actual).toLowerCase())
  )
    throw new RegressionTargetError(
      'Target must be a regular file compatible with the baseline language.'
    );
  return actual;
}

/** Contained target bytes, executed exactly like the baseline's captured source. */
export async function readRegressionTarget(
  root: string,
  target: string,
  language: string,
  limit: number
): Promise<string> {
  const actual = await resolveRegressionTarget(root, target, language);
  try {
    return await readBoundedSuite(actual, limit);
  } catch {
    throw new RegressionTargetError('Target is too large or is not valid UTF-8 text.');
  }
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
