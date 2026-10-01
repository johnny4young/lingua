import { prepareNotebookDocument } from './notebookDocumentOpen';
import { notebookDocumentNotice } from './notebookDocumentPersistence';
import { useNotebookStore } from './notebookStore';
import { notebookDocumentSnapshot } from './notebookDocumentPersistence';

/** Disk reconciliation is lazy; ordinary sessions never load notebook recovery. */
export async function restoreNotebookDocument(
  id: string,
  saved: { filePath?: string; content: string; notebookDocumentHash?: string | null },
  hasRoot: boolean,
  content: string
) {
  let notebookDocumentHash = saved.notebookDocumentHash;
  const local = notebookDocumentSnapshot(id);
  if (saved.filePath && hasRoot) {
    const disk = await prepareNotebookDocument(content);
    if (disk && (local === null || local === saved.content || local === disk.content)) {
      useNotebookStore
        .getState()
        .installImportedNotebook(id, disk.document.notebook, disk.document.executionOrder);
      content = disk.content;
      notebookDocumentHash = disk.hash;
    } else {
      // Keep recovered edits and their original expected disk hash.
      // A changed/invalid disk file cannot become an implicit baseline.
      content = saved.content;
      notebookDocumentNotice(disk ? 'conflict' : 'invalid');
    }
  } else {
    content = saved.content;
    if (local === null && content) {
      const recovered = await prepareNotebookDocument(content);
      if (recovered)
        useNotebookStore
          .getState()
          .installImportedNotebook(
            id,
            recovered.document.notebook,
            recovered.document.executionOrder
          );
    }
  }
  return { content, notebookDocumentHash };
}
