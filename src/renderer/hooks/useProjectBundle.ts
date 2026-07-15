/**
 * RL-024 Slice 3 — project zip bundle export + import choreography.
 *
 * Export:
 *   - Desktop: `fs:exportBundle(rootId, { entryFile, languageHint })`
 *     packs every visible file (main excludes `node_modules` / `.git` /
 *     `dist` / `build` via `shouldHide` — fold G) and writes the `.zip`
 *     through a save dialog.
 *   - Web: collect the loaded project files via the FSA adapter, pack
 *     with the shared `packBundle`, and trigger a Blob download
 *     (text-only; binary asset fidelity is a desktop concern).
 *
 * Import (desktop only; web surfaces `projectBundle.web.unsupported`):
 *   - The overlay supplies the raw `.zip` bytes; `fs:importBundle`
 *     re-validates (zip-slip / zip-bomb / caps) in the trusted main
 *     process, prompts for an empty target folder, writes the files,
 *     and `rememberApprovedRoot`s it. We then adopt the root via the
 *     existing `openProject(rootPath)` → `fs:reopen-root` path and open
 *     the manifest's `entryFile` as the active tab so the import is
 *     usable "without manual repair".
 *
 * Every terminal path fires exactly one closed-enum telemetry event;
 * the qualitative reject reason additionally fires `bundle_rejected`.
 */

import { useCallback } from 'react';
import { strToU8 } from 'fflate';
import { packBundle, type ProjectBundleFile } from '../../shared/projectBundle';
import { useProjectStore } from '../stores/projectStore';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { languageFromPath } from '../utils/language';
import type { Language } from '../types';
import { useStatusNotice } from './useStatusNotice';
import {
  trackBundleExported,
  trackBundleImported,
  trackBundleRejected,
} from './projectBundleTelemetry';

function basenameForRelPath(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx >= 0 ? relPath.slice(idx + 1) : relPath;
}

export interface UseProjectBundleApi {
  /** Export the active project to a `.zip` bundle. */
  exportProjectBundle: () => Promise<void>;
  /** Import a `.zip` bundle (raw bytes) into a new project folder. */
  importProjectBundle: (zipBytes: Uint8Array) => Promise<void>;
}

export function useProjectBundle(): UseProjectBundleApi {
  const { error, success, warning } = useStatusNotice();
  const openProject = useProjectStore(s => s.openProject);
  const openFile = useEditorStore(s => s.openFile);

  const exportProjectBundle = useCallback(async (): Promise<void> => {
    const project = useProjectStore.getState().currentProject;
    if (!project) {
      warning('projectBundle.export.empty');
      trackBundleExported('empty', 0);
      return;
    }

    // Stamp the active tab into the manifest ONLY when it belongs to this
    // project (a scratchpad / single-file tab has no project-relative path).
    const editor = useEditorStore.getState();
    const active = getActiveTab(editor);
    const entryFile = active && active.rootId === project.rootId ? active.relativePath : undefined;
    const languageHint = entryFile ? active?.language : undefined;

    const platform = typeof window !== 'undefined' ? window.lingua?.platform : undefined;

    if (platform === 'web') {
      try {
        const indexed = await window.lingua.fs.listAllFiles(project.rootId);
        if (indexed.length === 0) {
          warning('projectBundle.export.empty');
          trackBundleExported('empty', 0);
          return;
        }
        const files: ProjectBundleFile[] = [];
        for (const entry of indexed) {
          const content = await window.lingua.fs.read(project.rootId, entry.relativePath);
          files.push({ path: entry.relativePath, bytes: strToU8(content) });
        }
        const zip = packBundle(files, {
          createdAt: new Date().toISOString(),
          entryFile,
          languageHint,
        });
        triggerBlobDownload(zip, `${project.name || 'project'}.zip`);
        trackBundleExported('exported', files.length);
        success('projectBundle.export.success', {
          values: { count: files.length },
        });
      } catch {
        error('projectBundle.export.failed');
        trackBundleExported('failed', 0);
      }
      return;
    }

    let result;
    try {
      result = await window.lingua.fs.exportBundle(project.rootId, {
        entryFile,
        languageHint,
      });
    } catch {
      // The IPC handler throws only on the deliberate denylist guard
      // (e.g. the user picks a protected save path). Surface a graceful
      // notice instead of letting the rejection go unhandled.
      error('projectBundle.export.failed');
      trackBundleExported('failed', 0);
      return;
    }
    if ('canceled' in result) {
      trackBundleExported('cancelled', 0);
      return;
    }
    if (!result.ok) {
      const status = result.reason === 'empty' ? 'empty' : 'failed';
      if (result.reason === 'empty') {
        warning('projectBundle.export.empty');
      } else {
        error('projectBundle.export.failed');
      }
      trackBundleExported(status, 0);
      return;
    }
    trackBundleExported('exported', result.fileCount);
    success('projectBundle.export.success', {
      values: { count: result.fileCount },
    });
  }, [error, success, warning]);

  const importProjectBundle = useCallback(
    async (zipBytes: Uint8Array): Promise<void> => {
      const platform = typeof window !== 'undefined' ? window.lingua?.platform : undefined;
      if (platform === 'web') {
        warning('projectBundle.web.unsupported');
        trackBundleImported('rejected', 0);
        return;
      }

      let result;
      try {
        result = await window.lingua.fs.importBundle(zipBytes);
      } catch {
        // Denylist guard throw (protected target dir) — graceful notice
        // rather than an unhandled rejection.
        error('projectBundle.import.failed');
        trackBundleImported('rejected', 0);
        return;
      }
      if ('canceled' in result) {
        trackBundleImported('cancelled', 0);
        return;
      }
      if (!result.ok) {
        if (result.reason === 'non-empty-dir') {
          warning('projectBundle.import.nonEmptyDir');
          trackBundleImported('non-empty-dir', 0);
          return;
        }
        if (result.reason === 'write-failed') {
          error('projectBundle.import.failed');
          trackBundleImported('rejected', 0);
          return;
        }
        // Structural archive reject — surface the qualitative reason AND
        // fire the dedicated reject event for the maintainer's funnel.
        trackBundleRejected(result.reason);
        trackBundleImported('rejected', 0);
        error(`projectBundle.reject.${result.reason}`);
        return;
      }

      try {
        await openProject(result.rootPath);
      } catch {
        error('projectBundle.import.failed');
        trackBundleImported('rejected', 0);
        return;
      }

      const project = useProjectStore.getState().currentProject;
      if (!project || project.rootPath !== result.rootPath) {
        error('projectBundle.import.failed');
        trackBundleImported('rejected', 0);
        return;
      }
      if (result.entryFile) {
        const language: Language | undefined = languageFromPath(result.entryFile);
        if (language) {
          try {
            await openFile(
              project.rootId,
              result.entryFile,
              basenameForRelPath(result.entryFile),
              language,
              `${result.rootPath}/${result.entryFile}`
            );
          } catch {
            // Tree is already populated; failing to auto-open the entry
            // file is non-fatal — the user can click it in the tree.
          }
        }
      }

      trackBundleImported('imported', result.fileCount);
      success('projectBundle.import.success');
    },
    [error, openFile, openProject, success, warning]
  );

  return { exportProjectBundle, importProjectBundle };
}

/** Trigger a browser download of `bytes` as `filename` (web export). */
function triggerBlobDownload(bytes: Uint8Array, filename: string): void {
  // `bytes as BlobPart` — fflate types its output as
  // `Uint8Array<ArrayBufferLike>`, which the DOM lib's `BlobPart` (an
  // `ArrayBufferView<ArrayBuffer>`) rejects under TS's SharedArrayBuffer
  // variance check. The runtime value is a plain Uint8Array; the cast is
  // sound.
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
