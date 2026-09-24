/** Exercise the shipped web bridge against Chromium's real OPFS handles. */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test('web filesystem persists edits and revocation stops subsequent access', async ({ page }) => {
  await page.addInitScript(() => {
    // Replace only the user-gesture picker boundary. All directory and file
    // handles below are real browser-managed OPFS handles, not test doubles.
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        const storageRoot = await navigator.storage.getDirectory();
        return storageRoot.getDirectoryHandle('lingua-e2e-project', { create: true });
      },
    });
  });
  await seedSession(page, { language: 'en' });
  await gotoApp(page);

  const result = await page.evaluate(async () => {
    const fs = window.lingua.fs;
    const picked = await fs.selectDirectory();
    if (picked.canceled) throw new Error('OPFS project picker failed');
    const rootId = picked.rootId;
    const filePath = 'notes/hello.txt' as Parameters<typeof fs.read>[1];
    const directoryPath = 'notes' as Parameters<typeof fs.readdir>[1];
    const rootPath = '' as Parameters<typeof fs.readdir>[1];

    const wrote = await fs.write(rootId, filePath, 'first\nneedle in OPFS\n');
    const read = await fs.read(rootId, filePath);
    const entries = await fs.readdir(rootId, directoryPath);
    const matches = await fs.searchInFiles(rootId, rootPath, 'needle');
    const revoked = await fs.revokeRoot(rootId);
    const wroteAfterRevoke = await fs.write(rootId, filePath, 'stale write');
    let readAfterRevoke = '';
    try {
      await fs.read(rootId, filePath);
    } catch (error) {
      readAfterRevoke = error instanceof Error ? error.message : String(error);
    }
    let listAfterRevoke = '';
    try {
      await fs.readdir(rootId, rootPath);
    } catch (error) {
      listAfterRevoke = error instanceof Error ? error.message : String(error);
    }

    const storageRoot = await navigator.storage.getDirectory();
    const project = await storageRoot.getDirectoryHandle('lingua-e2e-project');
    const notes = await project.getDirectoryHandle('notes');
    const file = await notes.getFileHandle('hello.txt');
    const persisted = await (await file.getFile()).text();
    await storageRoot.removeEntry('lingua-e2e-project', { recursive: true });

    return {
      wrote,
      read,
      entries,
      matches,
      revoked,
      wroteAfterRevoke,
      readAfterRevoke,
      listAfterRevoke,
      persisted,
    };
  });

  expect(result.wrote).toBe(true);
  expect(result.read).toBe('first\nneedle in OPFS\n');
  expect(result.entries.map(entry => entry.name)).toEqual(['hello.txt']);
  expect(result.matches).toEqual([
    expect.objectContaining({
      relativePath: 'notes/hello.txt',
      matches: [expect.objectContaining({ line: 2, column: 1 })],
    }),
  ]);
  expect(result.revoked).toBe(true);
  expect(result.wroteAfterRevoke).toBe(false);
  expect(result.readAfterRevoke).toBe('unknown-root');
  expect(result.listAfterRevoke).toBe('unknown-root');
  expect(result.persisted).toBe('first\nneedle in OPFS\n');
});
