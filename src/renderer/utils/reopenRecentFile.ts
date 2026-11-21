import type { EditorState } from '../types/editor';
import type { Language } from '../types/language';
import { notifyBlockedPath } from './blockedPath';
import { PLAINTEXT_LANGUAGE } from './language';

/** Reopens a file from an earlier session; main approves only that file, not its folder. */
export async function reopenRecentFile(
  file: { path: string; name: string; language?: Language },
  openFile: EditorState['openFile']
): Promise<void> {
  const reopen = await window.lingua.fs.reopenFile(file.path);
  if (!reopen.ok) {
    if (reopen.error === 'blocked') void notifyBlockedPath(file.path);
    return;
  }
  await openFile(reopen.rootId, reopen.fileRelativePath, file.name, file.language ?? PLAINTEXT_LANGUAGE, file.path);
}
