import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeAtomicDocument } from '../../src/main/ipc/fs/documentWrite';
import { computeContentHash } from '../../src/shared/runCapsule';

describe('atomic document staging', () => {
  it('preserves lock-entry order for an already resolved shared destination', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-document-fifo-'));
    const file = path.join(root, 'document.linguanb');
    try {
      await writeFile(file, 'before'); const expected = await computeContentHash('before');
      const results = await Promise.all(['first', 'second'].map(content => writeAtomicDocument(file, content, expected, async () => file)));
      expect(results).toEqual([{ status: 'saved', hash: await computeContentHash('first') }, { status: 'conflict', actualHash: await computeContentHash('first') }]);
      expect(await readFile(file, 'utf8')).toBe('first');
      expect(await readdir(root)).toEqual(['document.linguanb']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(['changed', 'revoked'])('never commits over a %s destination during staging', async mode => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-document-'));
    const file = path.join(root, 'document.linguanb');
    try {
      await writeFile(file, 'before');
      const operation = writeAtomicDocument(file, 'ours', await computeContentHash('before'), async () => {
        if (mode === 'revoked') throw new Error('revoked');
        await writeFile(file, 'external'); return file;
      });
      if (mode === 'revoked') await expect(operation).rejects.toThrow('revoked');
      else expect(await operation).toEqual({ status: 'conflict', actualHash: await computeContentHash('external') });
      expect(await readFile(file, 'utf8')).toBe(mode === 'revoked' ? 'before' : 'external');
      expect(await readdir(root)).toEqual(['document.linguanb']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
