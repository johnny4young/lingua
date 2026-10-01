/** Mounted cell drafts flush synchronously before manual document save or close. */
const drafts = new Map<string, Set<() => void>>();
export function registerNotebookDocumentDraft(tabId: string, flush: () => void): () => void {
  const owned = drafts.get(tabId) ?? new Set<() => void>();
  owned.add(flush);
  drafts.set(tabId, owned);
  return () => {
    owned.delete(flush);
    if (owned.size === 0) drafts.delete(tabId);
  };
}
export function flushNotebookDocumentDrafts(tabId: string): void {
  for (const flush of [...(drafts.get(tabId) ?? [])]) flush();
}
