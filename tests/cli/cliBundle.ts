import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe } from 'vitest';

export const BUNDLE_PATH = path.resolve(process.cwd(), 'dist/cli/lingua.cjs');
export const BUNDLE_AVAILABLE = existsSync(BUNDLE_PATH);
export const describeIfBundle = BUNDLE_AVAILABLE ? describe : describe.skip;

export function runCli(
  args: ReadonlyArray<string>,
  stdin?: string,
  environment: Readonly<Record<string, string | undefined>> = {}
) {
  const result = spawnSync(process.execPath, [BUNDLE_PATH, ...args], {
    input: stdin,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...environment },
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
