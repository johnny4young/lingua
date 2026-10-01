/** Optimistic document commits. A hash is evidence, never filesystem authority. */
export type DocumentWriteResult =
  { status: 'saved'; hash: string } | { status: 'conflict'; actualHash: string | null };

// Serialize competing saves within this process, including two windows. External
// processes are not locked; backends recheck the hash immediately before commit.
const pending = new Map<string, Promise<unknown>>();
export async function withDocumentWriteLock<T>(key: string, write: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);
  pending.set(key, next);
  try {
    return await next;
  } finally {
    if (pending.get(key) === next) pending.delete(key);
  }
}

export interface DocumentWriteBridge {
  writeDocument: (
    rootId: import('./fs/brandedIds').RootId,
    relativePath: import('./fs/brandedIds').RelativePath,
    content: string,
    expectedHash: string | null
  ) => Promise<DocumentWriteResult>;
}
