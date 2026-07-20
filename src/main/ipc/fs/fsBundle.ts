import { dialog, BrowserWindow } from 'electron';
import { mkdir as mkdirFs, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { typedHandle } from '../typedHandle';
import { blockedPathFamily } from '../permissions';
import { type RootId } from '../projectCapabilities';
import {
  MAX_BUNDLE_ENTRY_BYTES,
  MAX_BUNDLE_FILES,
  packBundle,
  unpackBundle,
  validateBundleEntryPath,
  type BundleRejectReason,
  type ProjectBundleFile,
} from '../../../shared/projectBundle';
import {
  EMPTY_DIR_IGNORE,
  coerceBundleBytes,
  joinRelative,
  resolveOrThrow,
  shouldHide,
} from './fsShared';

/**
 * internal — project bundle export/import handlers, extracted VERBATIM
 * from `fileSystem.ts`. The import handler adopts the target directory
 * into the approval list, so `rememberApprovedRoot` is injected by the
 * assembly (the approval state stays owned by `fileSystem.ts`).
 */
export function registerBundleHandlers(
  rememberApprovedRoot: (absolutePath: string) => Promise<void>
): void {
  typedHandle(
    'fs:exportBundle',
    async (
      event,
      rootId: RootId,
      opts?: { entryFile?: string; languageHint?: string }
    ): Promise<
      | { ok: true; fileCount: number; byteLength: number }
      | { canceled: true }
      | { ok: false; reason: 'empty' | 'too-many-files' | 'write-failed' }
    > => {
      const { absolutePath: rootAbsolute, rootPath } = await resolveOrThrow(
        rootId,
        '',
        'read'
      );

      const collected: ProjectBundleFile[] = [];
      let tooMany = false;
      async function walk(dirPath: string, rel: string): Promise<void> {
        if (tooMany) return;
        let entries;
        try {
          entries = await readdir(dirPath, { withFileTypes: true });
        } catch {
          return; // unreadable dir — best-effort, skip
        }
        for (const entry of entries) {
          if (tooMany) return;
          if (shouldHide(entry.name)) continue;
          const entryPath = path.join(dirPath, entry.name);
          const entryRel = joinRelative(rel, entry.name);
          if (entry.isDirectory()) {
            await walk(entryPath, entryRel);
            continue;
          }
          if (!entry.isFile()) continue; // skip symlinks, sockets, fifos
          if (collected.length >= MAX_BUNDLE_FILES) {
            tooMany = true;
            return;
          }
          let bytes: Buffer;
          try {
            bytes = await readFile(entryPath);
          } catch {
            continue;
          }
          if (bytes.byteLength > MAX_BUNDLE_ENTRY_BYTES) continue; // skip oversized single file
          collected.push({ path: entryRel, bytes: new Uint8Array(bytes) });
        }
      }
      await walk(rootAbsolute, '');

      if (tooMany) return { ok: false, reason: 'too-many-files' };
      if (collected.length === 0) return { ok: false, reason: 'empty' };

      let zipBytes: Uint8Array;
      try {
        zipBytes = packBundle(collected, {
          createdAt: new Date().toISOString(),
          entryFile:
            typeof opts?.entryFile === 'string' ? opts.entryFile : undefined,
          languageHint:
            typeof opts?.languageHint === 'string'
              ? opts.languageHint
              : undefined,
        });
      } catch {
        return { ok: false, reason: 'write-failed' };
      }

      const defaultName = `${path.basename(rootPath) || 'project'}.zip`;
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const saveOptions = {
        defaultPath: defaultName,
        filters: [{ name: 'Zip bundle', extensions: ['zip'] }],
      };
      const saved = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
      if (saved.canceled || !saved.filePath) return { canceled: true };
      const savedBlockedFamily = blockedPathFamily(saved.filePath);
      if (savedBlockedFamily) {
        throw new Error(
          `Access denied: cannot save to protected ${savedBlockedFamily} path: ${saved.filePath}`
        );
      }
      try {
        await writeFile(saved.filePath, zipBytes);
      } catch {
        return { ok: false, reason: 'write-failed' };
      }
      return {
        ok: true,
        fileCount: collected.length,
        byteLength: zipBytes.byteLength,
      };
    }
  );

  // ----------------------------------------------- import project bundle

  /**
   * implementation — extract a `.zip` bundle into a user-chosen folder.
   * The renderer supplies the raw bytes (read from a dropped / picked
   * file); main is the AUTHORITATIVE security boundary: it re-runs
   * `unpackBundle` (zip-slip + zip-bomb + caps), re-validates every entry
   * path, and re-checks the resolved absolute path stays under the chosen
   * dir before writing — never trusting a renderer-side preview. Files
   * are written as REGULAR files only (never symlinks), so a symlink
   * entry decodes to an inert regular file that cannot escape (implementation note).
   * On success it `rememberApprovedRoot`s the target so the renderer's
   * existing `openProject(rootPath)` → `fs:reopen-root` path adopts it.
   */
  typedHandle(
    'fs:importBundle',
    async (
      _event,
      zipBytes: unknown
    ): Promise<
      | { ok: true; rootPath: string; fileCount: number; entryFile?: string }
      | { canceled: true }
      | { ok: false; reason: BundleRejectReason | 'non-empty-dir' | 'write-failed' }
    > => {
      const bytes = coerceBundleBytes(zipBytes);
      if (!bytes) return { ok: false, reason: 'malformed-zip' };
      const unpacked = unpackBundle(bytes);
      if (!unpacked.ok) return { ok: false, reason: unpacked.reason };

      const picked = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { canceled: true };
      }
      const targetDir = picked.filePaths[0]!;
      const targetBlockedFamily = blockedPathFamily(targetDir);
      if (targetBlockedFamily) {
        throw new Error(
          `Access denied: cannot write to protected ${targetBlockedFamily} path: ${targetDir}`
        );
      }

      // Empty-dir safety — refuse to scatter files into a populated
      // folder so an import never clobbers existing work.
      try {
        const existing = await readdir(targetDir);
        const meaningful = existing.filter((name) => !EMPTY_DIR_IGNORE.has(name));
        if (meaningful.length > 0) return { ok: false, reason: 'non-empty-dir' };
      } catch {
        return { ok: false, reason: 'write-failed' };
      }

      const targetRootPath = path.normalize(targetDir);
      const targetReal = path.resolve(targetRootPath);
      try {
        for (const file of unpacked.files) {
          const safe = validateBundleEntryPath(file.path);
          if (safe === null) continue; // already filtered, belt + braces
          const absolute = path.resolve(targetReal, safe);
          const rel = path.relative(targetReal, absolute);
          if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // escape guard
          await mkdirFs(path.dirname(absolute), { recursive: true });
          await writeFile(absolute, Buffer.from(file.bytes));
        }
      } catch {
        return { ok: false, reason: 'write-failed' };
      }

      await rememberApprovedRoot(targetDir);
      const entryFile =
        unpacked.manifest?.entryFile &&
        unpacked.files.some((f) => f.path === unpacked.manifest!.entryFile)
          ? unpacked.manifest.entryFile
          : undefined;
      return {
        ok: true,
        rootPath: targetRootPath,
        fileCount: unpacked.files.length,
        ...(entryFile ? { entryFile } : {}),
      };
    }
  );
}
