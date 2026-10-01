import { createHash, randomUUID } from 'node:crypto';
import { stat, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { MAX_LINGUANB_BYTES } from '../../../shared/notebookDocumentFormat';
import { type DocumentWriteResult, withDocumentWriteLock } from '../../../shared/documentWrite';

async function diskHash(file: string): Promise<string | null> {
  try {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(file)) {
      bytes += chunk.length;
      if (bytes > MAX_LINGUANB_BYTES) throw new Error('Existing document exceeds its size limit.');
      hash.update(chunk);
    }
    return hash.digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Caller owns capability validation, including a fresh validation before rename. */
export async function writeAtomicDocument(
  file: string,
  content: string,
  expectedHash: string | null,
  revalidate: () => Promise<string>
): Promise<DocumentWriteResult> {
  return withDocumentWriteLock(file, async () => {
    const actualHash = await diskHash(file);
    if (actualHash !== expectedHash) return { status: 'conflict', actualHash };
    const temporary = path.join(path.dirname(file), `.lingua-document-${randomUUID()}.tmp`);
    // Preserve an existing file's mode; new documents are private by default.
    const mode = await stat(file)
      .then(info => info.mode & 0o777)
      .catch(error => {
        if (error.code === 'ENOENT') return 0o600;
        throw error;
      });
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
      const destination = await revalidate();
      if (destination !== file) throw new Error('Document destination changed.');
      const beforeCommit = await diskHash(file);
      if (beforeCommit !== expectedHash) return { status: 'conflict', actualHash: beforeCommit };
      await rename(temporary, file);
      return { status: 'saved', hash: createHash('sha256').update(content).digest('hex') };
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
}
