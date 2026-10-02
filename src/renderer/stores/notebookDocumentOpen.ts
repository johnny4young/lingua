import { parseNotebookDocument } from '../../shared/notebookDocument';
import { computeContentHash } from '../../shared/contentHash';
import { serializeNotebookDocument } from '../../shared/notebookDocumentFormat';
import { useNotebookStore } from './notebookStore';
import { notebookDocumentNotice } from './notebookDocumentPersistence';

/** Document parsing and installation are lazy; opening remains inert. */
export async function prepareNotebookDocument(source: string) {
  const parsed = parseNotebookDocument(source);
  if (!parsed.ok) {
    notebookDocumentNotice('invalid');
    return null;
  }
  return {
    document: parsed.document,
    content: serializeNotebookDocument(parsed.document.notebook, {
      executionOrder: parsed.document.executionOrder,
    }),
    hash: await computeContentHash(source),
  };
}
type PreparedDocument = NonNullable<Awaited<ReturnType<typeof prepareNotebookDocument>>>;
export function notebookTabMetadata(prepared: PreparedDocument) {
  return {
    kind: 'notebook' as const,
    notebookDocumentHash: prepared.hash,
    language: 'javascript' as const,
  };
}
export function installPreparedNotebook(id: string, prepared: PreparedDocument): void {
  useNotebookStore
    .getState()
    .installImportedNotebook(id, prepared.document.notebook, prepared.document.executionOrder);
}
