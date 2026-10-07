import { MAX_LINGUANB_BYTES } from '../../shared/notebookDocumentFormat';
import { computeContentHash } from '../../shared/contentHash';
import { utf8ByteLength } from '../../shared/utf8';
import { asRootId, asRelativePath } from '../../shared/fs/brandedIds';
import type { FileTab } from '../types/editor';
import { useProjectStore } from './projectStore';
import { joinAbsolute } from '../utils/filePath';
import { notifyBlockedFamily } from '../utils/blockedPath';
import { notebookDocumentNotice } from './notebookDocumentPersistence';
import { notebookConflictActions } from './notebookConflictActions';

/** Loaded only for explicit document saves, never for initial dirty tracking. */
export async function persistNotebookDocument(
  tab: FileTab,
  saveAs: boolean,
  stillOpen: () => boolean,
  content: string | null
): Promise<FileTab | null> {
  if (content === null || utf8ByteLength(content) > MAX_LINGUANB_BYTES) {
    notebookDocumentNotice('invalid');
    return null;
  }
  let destination = tab;
  let newRoot: string | undefined;
  try {
    if (saveAs || !tab.rootId || !tab.relativePath) {
      if (
        window.lingua.platform === 'web' &&
        typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker !==
          'function'
      ) {
        notebookDocumentNotice('unavailable');
        return null;
      }
      const pick = await window.lingua.fs.saveDialog(
        tab.name.endsWith('.linguanb') ? tab.name : `${tab.name}.linguanb`
      );
      if (pick.canceled) {
        notifyBlockedFamily(pick.blockedFamily);
        return null;
      }
      newRoot = pick.rootId;
      if (!stillOpen()) return null;
      if (!pick.fileRelativePath.toLowerCase().endsWith('.linguanb')) {
        notebookDocumentNotice('invalid');
        return null;
      }
      let expectedHash: string | null = null;
      try {
        const info = await window.lingua.fs.stat(pick.rootId, pick.fileRelativePath);
        if (!info.isFile || info.size > MAX_LINGUANB_BYTES) {
          notebookDocumentNotice('invalid');
          return null;
        }
        expectedHash = await computeContentHash(
          await window.lingua.fs.read(pick.rootId, pick.fileRelativePath)
        );
      } catch {
        /* A new desktop destination does not exist yet; the writer still checks null. */
      }
      destination = {
        ...tab,
        rootId: pick.rootId,
        relativePath: pick.fileRelativePath,
        filePath: joinAbsolute(pick.rootPath, pick.fileRelativePath),
        name: pick.fileRelativePath.split(/[\\/]/).at(-1)!,
        notebookDocumentHash: expectedHash,
      };
    }
    if (!stillOpen()) return null;
    const result = await window.lingua.fs.writeDocument(
      asRootId(destination.rootId!),
      asRelativePath(destination.relativePath!),
      content,
      destination.notebookDocumentHash ?? null
    );
    if (result.status === 'conflict') {
      // A Save As destination is not the tab's file, so only retrying fits.
      const ownFile = destination === tab;
      notebookDocumentNotice(
        ownFile ? 'conflict' : 'destinationConflict',
        notebookConflictActions(tab.id, ownFile)
      );
      return null;
    }
    // The caller adopts metadata only. New cell edits/outputs in notebookStore
    // are never replaced by this pre-picker snapshot.
    newRoot = undefined;
    notebookDocumentNotice('saved');
    return { ...destination, content, notebookDocumentHash: result.hash, isDirty: false };
  } catch {
    notebookDocumentNotice('writeFailed');
    return null;
  } finally {
    if (
      newRoot &&
      newRoot !== tab.rootId &&
      newRoot !== useProjectStore.getState().currentProject?.rootId
    ) {
      await window.lingua.fs.revokeRoot(asRootId(newRoot)).catch(() => {});
    }
  }
}
