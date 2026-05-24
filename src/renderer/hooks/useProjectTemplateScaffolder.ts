// SPDX-License-Identifier: MIT
/**
 * RL-103 Slice 1 — Project template scaffold hook.
 *
 * Owns the multi-file write choreography for a curated
 * `ProjectTemplateV1`. The flow is intentionally per-step so failures
 * surface a precise outcome the UI can map to a single user-readable
 * notice:
 *
 *   1. Folder picker (`fs:select-directory`) — mints a capability
 *      `rootId` we hold for the safety check + the writes. If the
 *      user cancels we bail without touching any store.
 *   2. Empty-dir safety (fold D) — `readdir('')` and filter against
 *      `EMPTY_DIR_IGNORE` (`.DS_Store`, `.localized`, `Icon\r`,
 *      `.AppleDouble`, `Thumbs.db`, `desktop.ini`). If anything
 *      meaningful remains we revoke the capability and return
 *      `non-empty-dir`. The user picks a different folder.
 *   3. mkdir + write (folds E, F honored at template-content level) —
 *      iterate `template.files` once, collect distinct parent dirs,
 *      run `fs.mkdir` for each (recursive on the main side) before
 *      `fs.write` for each file. The order matters because the main
 *      `fs:write` handler does NOT auto-create parents.
 *   4. Hand-off to the project store — `revokeRoot` our holding
 *      capability and call `openProject(rootPath)`. That mints a
 *      fresh `rootId` on `currentProject` and starts the file
 *      watcher; the new files surface in the tree automatically.
 *   5. Open the entry file — `editorStore.openFile(rootId, entryFile…)`
 *      reads the content we just wrote and creates a tab.
 *   6. Telemetry (fold B) — `trackTemplateProjectApplied` fires
 *      after the entry file opens so a partial scaffold (write
 *      errored mid-way) never registers a "success" signal.
 *   7. Return `{ kind: 'success', rootId, rootPath, entryFile }`
 *      so the caller can offer a Reveal-in-Finder CTA (fold A)
 *      against the freshly-minted rootId.
 *
 * The web build never reaches this hook — `ProjectTemplatesPanel`
 * short-circuits to a notice on the `platform === 'web'` branch
 * because `fs:select-directory` has no FSA equivalent that survives
 * cross-origin sandboxing.
 *
 * Returned union is exhaustive so callers can `switch (result.kind)`
 * with type-narrowing — no `result.ok` indirection.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  projectTemplateDirname,
  type ProjectTemplateV1,
} from '../../shared/projectTemplate';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import type { Language } from '../types';
import { trackTemplateProjectApplied } from './projectTemplateTelemetry';

/**
 * OS metadata files that the empty-dir guard treats as non-blocking.
 * macOS sprinkles `.DS_Store` and `.localized` on every directory
 * touched by Finder; Windows seeds `Thumbs.db` on first preview
 * generation. Refusing to scaffold into a directory that happens to
 * contain just these would be a user-hostile false positive.
 *
 * Reviewer-pass additions (RL-103 fold A):
 *   - `Icon\r` (carriage-return char in filename) — written by macOS
 *     Finder when the user sets a custom folder icon. Extremely
 *     common in user-curated folders; without this guard every
 *     custom-iconned folder failed the safety check.
 *   - `.AppleDouble` — created by older AFP/SMB-backed shares (NAS,
 *     Time Machine). Less common locally but a guaranteed false
 *     positive on network-synced folders.
 */
const EMPTY_DIR_IGNORE = new Set<string>([
  '.DS_Store',
  '.localized',
  'Icon\r',
  '.AppleDouble',
  'Thumbs.db',
  'desktop.ini',
]);

export type ScaffoldResult =
  | { kind: 'success'; rootId: string; rootPath: string; entryFile: string }
  | { kind: 'canceled' }
  | { kind: 'non-empty-dir'; meaningfulCount: number }
  | { kind: 'web-unavailable' }
  | { kind: 'error'; message: string };

type ReaddirEntry = { name: string };

export interface UseProjectTemplateScaffolderApi {
  scaffold: (template: ProjectTemplateV1) => Promise<ScaffoldResult>;
}

export function useProjectTemplateScaffolder(): UseProjectTemplateScaffolderApi {
  const { t } = useTranslation();
  const openProject = useProjectStore((state) => state.openProject);
  const openFile = useEditorStore((state) => state.openFile);

  const scaffold = useCallback(
    async (template: ProjectTemplateV1): Promise<ScaffoldResult> => {
      // Web build has no `selectDirectory`; the panel already gates
      // the click, but a defense-in-depth check here keeps the hook
      // safe if a future caller wires it from a non-UI surface.
      const platform =
        typeof window !== 'undefined' ? window.lingua?.platform : undefined;
      if (platform === 'web') {
        return { kind: 'web-unavailable' };
      }

      const picker = await window.lingua.fs.selectDirectory();
      if (picker.canceled) {
        return { kind: 'canceled' };
      }
      const holdingRootId: string = picker.rootId;
      const rootPath: string = picker.rootPath;

      // Empty-dir safety. `readdir('')` returns the immediate root
      // entries (not a recursive walk) which is exactly the scope of
      // "the user picked a fresh folder" check.
      let entries: ReaddirEntry[];
      try {
        entries = (await window.lingua.fs.readdir(
          holdingRootId,
          ''
        )) as ReaddirEntry[];
      } catch (error) {
        await window.lingua.fs.revokeRoot(holdingRootId).catch(() => {});
        return {
          kind: 'error',
          message: errorToString(error, t('emptyState.projectTemplates.error.readdir')),
        };
      }
      const meaningful = entries.filter(
        (entry) => !EMPTY_DIR_IGNORE.has(entry.name)
      );
      if (meaningful.length > 0) {
        await window.lingua.fs.revokeRoot(holdingRootId).catch(() => {});
        return { kind: 'non-empty-dir', meaningfulCount: meaningful.length };
      }

      // mkdir + write. Distinct parent dirs are deduped so we don't
      // call mkdir N times for files that share a directory. The
      // dedup is at the *immediate* parent granularity, NOT all
      // ancestors — correctness relies on the main-side `fs:mkdir`
      // handler calling `mkdirFs(absolute, { recursive: true })`
      // (see `src/main/ipc/fileSystem.ts` `fs:mkdir`). If that
      // recursive flag ever flips, this loop would need to walk
      // every ancestor segment explicitly.
      const dirsCreated = new Set<string>();
      try {
        for (const file of template.files) {
          const parent = projectTemplateDirname(file.relPath);
          if (parent && !dirsCreated.has(parent)) {
            await window.lingua.fs.mkdir(holdingRootId, parent);
            dirsCreated.add(parent);
          }
          await window.lingua.fs.write(
            holdingRootId,
            file.relPath,
            file.content
          );
        }
      } catch (error) {
        await window.lingua.fs.revokeRoot(holdingRootId).catch(() => {});
        return {
          kind: 'error',
          message: errorToString(
            error,
            t('emptyState.projectTemplates.error.write')
          ),
        };
      }

      // Revoke the holding capability before `openProject` mints a
      // fresh one for the same path. Without the revoke we'd leak a
      // dangling token on every scaffold.
      await window.lingua.fs.revokeRoot(holdingRootId).catch(() => {});

      try {
        await openProject(rootPath);
      } catch (error) {
        return {
          kind: 'error',
          message: errorToString(
            error,
            t('emptyState.projectTemplates.error.openProject')
          ),
        };
      }
      // `useProjectStore.getState()` reads the current Zustand
      // snapshot synchronously. Zustand's `set()` is synchronous
      // (NOT React-batched), so `await openProject(rootPath)`
      // guarantees `currentProject` is populated by the time the
      // promise resolves. The null check below is a defensive
      // belt-and-braces guard for the failure path where
      // `openProject` rejects via a try-no-throw branch that leaves
      // `currentProject` untouched.
      const cp = useProjectStore.getState().currentProject;
      if (!cp) {
        return {
          kind: 'error',
          message: t('emptyState.projectTemplates.error.openProject'),
        };
      }

      // Open the entry file in a new tab. Name is derived from the
      // basename of the entry file so the tab title matches the
      // user's mental model rather than an internal id.
      const entryBasename = basenameForRelPath(template.entryFile);
      try {
        await openFile(
          cp.rootId,
          template.entryFile,
          entryBasename,
          template.language as Language,
          // displayPath — the renderer uses this for recent-files
          // lookups and tooltip text. Passing the full absolute path
          // matches the QuickOpen pattern when reopening a saved
          // file from disk.
          `${rootPath}/${template.entryFile}`
        );
      } catch (error) {
        return {
          kind: 'error',
          message: errorToString(
            error,
            t('emptyState.projectTemplates.error.openEntry')
          ),
        };
      }

      // Telemetry fires AFTER the entry tab is in place. The
      // language is the language-pack id from the template — never
      // a runtime-derived value — so the closed-enum redactor sees
      // exactly the same string the validator allowlist trusts.
      trackTemplateProjectApplied({
        templateId: template.id,
        language: template.language,
      });

      return {
        kind: 'success',
        rootId: cp.rootId,
        rootPath,
        entryFile: template.entryFile,
      };
    },
    [openFile, openProject, t]
  );

  return { scaffold };
}

function basenameForRelPath(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx >= 0 ? relPath.slice(idx + 1) : relPath;
}

function errorToString(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return fallback;
}
