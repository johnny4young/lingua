import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';

// Windows keeps a directory locked (EBUSY) briefly after a child process that used it exits.
const RETRY = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;

export function removeTempDir(dir: string): Promise<void> {
  return rm(dir, RETRY);
}

export function removeTempDirSync(dir: string): void {
  rmSync(dir, RETRY);
}
