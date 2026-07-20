// SPDX-License-Identifier: MIT
/**
 * Project template schema .
 *
 * A `ProjectTemplateV1` describes a multi-file scaffold the renderer
 * writes into an empty directory chosen by the user. Single-file
 * starters keep living in `src/renderer/data/templates.ts`
 * (`BUILT_IN_TEMPLATES`); the two surfaces never overlap and the
 * naming is qualified everywhere so a future shared helper does not
 * shadow either set.
 *
 * Why a TypeScript module rather than JSON: literal modules type-check
 * the language ids against `LANGUAGE_PACKS`, let editors jump-to-def
 * when reading a card, and keep the content inline with the file
 * tree so the SPDX header guarantee (implementation note) is a single grep instead
 * of a generated artifact contract.
 *
 * The `parseProjectTemplate` validator owns three guards the writer
 * cannot rely on the type-checker to enforce at compile time:
 *
 *   - **No path traversal** — `relPath` must be POSIX-style, relative,
 *     and never resolve to a parent directory (`..` segments or
 *     absolute forms are rejected). Mirrors the same idiom the IPC
 *     fileSystem layer uses for `fs:write`; we double-validate here
 *     because the renderer fans out the writes one by one and
 *     should not pass anything to the bridge that the bridge would
 *     reject.
 *   - **Unique `relPath` set** — a template that declares two
 *     entries for `src/index.js` would silently overwrite the first
 *     on write; the validator surfaces the duplicate before the
 *     writer ever runs.
 *   - **Entry file membership** — `entryFile` must point at one of
 *     the declared `files[]` entries so the scaffold hook can
 *     reliably open it post-write.
 *
 * Empty file content is allowed deliberately — a template that ships
 * an empty `.env.example` or an empty `.gitignore.placeholder` is a
 * legitimate shape; the schema does not over-constrain.
 */

import { LANGUAGE_PACKS } from './languagePacks';

const VALID_LANGUAGE_IDS: ReadonlySet<string> = new Set(
  LANGUAGE_PACKS.map((pack) => pack.id as string)
);

export interface ProjectTemplateFile {
  /**
   * POSIX-style path relative to the destination root. Forward
   * slashes only; no leading `/`; no `.` or `..` segments after
   * normalization.
   */
  readonly relPath: string;
  /**
   * UTF-8 file content. Empty string is allowed; the writer treats
   * it as an empty file (touch + write '').
   */
  readonly content: string;
}

export interface ProjectTemplateDependencies {
  readonly npm?: readonly string[];
  readonly pip?: readonly string[];
}

export interface ProjectTemplateV1 {
  readonly schemaVersion: 1;
  /** Stable closed-enum id; mirrored on update-server for telemetry parity. */
  readonly id: string;
  /** i18n key for the card title; resolved at render time. */
  readonly labelKey: string;
  /** i18n key for the one-line description shown on the card. */
  readonly descriptionKey: string;
  /** Language pack id; must exist in `LANGUAGE_PACKS`. */
  readonly language: string;
  /**
   * `relPath` of the file we open in a new tab after scaffolding so
   * the user lands on the meaningful entry point rather than a
   * config file.
   */
  readonly entryFile: string;
  readonly files: readonly ProjectTemplateFile[];
  readonly dependencies?: ProjectTemplateDependencies;
  /**
   * Optional human-runnable command (`npm start`, `python main.py`).
   * implementation does not execute it — the field is informational and
   * may surface in a Reveal-in-Finder follow-up CTA. Stored so we
   * never have to re-introduce a schema bump if a later work wires
   * a "Run after scaffold" affordance.
   */
  readonly runCommand?: string;
  /** SPDX license identifier for the template content itself. */
  readonly license: string;
}

export type ProjectTemplateParseResult =
  | { ok: true; template: ProjectTemplateV1 }
  | { ok: false; reason: ProjectTemplateParseError };

export type ProjectTemplateParseError =
  | 'missing-id'
  | 'missing-label-key'
  | 'missing-description-key'
  | 'invalid-language'
  | 'missing-entry-file'
  | 'no-files'
  | 'invalid-rel-path'
  | 'duplicate-rel-path'
  | 'entry-file-not-in-files'
  | 'missing-license';

const POSIX_REL_PATH = /^(?!\/)(?!.*\/\/)[A-Za-z0-9._\-/]+$/;

function isValidRelPath(relPath: string): boolean {
  if (!POSIX_REL_PATH.test(relPath)) return false;
  if (relPath.startsWith('/')) return false;
  if (relPath.endsWith('/')) return false;
  const segments = relPath.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false;
  }
  return true;
}

/**
 * Strict validator. Returns `{ ok, template }` on success so callers
 * never have to second-guess that an in-source literal already
 * survived the type-checker; the runtime check exists because a
 * future contributor could regress one of the invariants and a
 * "trust the literal" assumption would land a broken template
 * silently.
 */
export function parseProjectTemplate(
  candidate: unknown
): ProjectTemplateParseResult {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, reason: 'missing-id' };
  }
  const raw = candidate as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return { ok: false, reason: 'missing-id' };
  }
  if (typeof raw.labelKey !== 'string' || raw.labelKey.length === 0) {
    return { ok: false, reason: 'missing-label-key' };
  }
  if (
    typeof raw.descriptionKey !== 'string' ||
    raw.descriptionKey.length === 0
  ) {
    return { ok: false, reason: 'missing-description-key' };
  }
  if (
    typeof raw.language !== 'string' ||
    !VALID_LANGUAGE_IDS.has(raw.language)
  ) {
    return { ok: false, reason: 'invalid-language' };
  }
  if (typeof raw.entryFile !== 'string' || raw.entryFile.length === 0) {
    return { ok: false, reason: 'missing-entry-file' };
  }
  if (typeof raw.license !== 'string' || raw.license.length === 0) {
    return { ok: false, reason: 'missing-license' };
  }
  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    return { ok: false, reason: 'no-files' };
  }

  const seen = new Set<string>();
  const files: ProjectTemplateFile[] = [];
  for (const entry of raw.files as unknown[]) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, reason: 'invalid-rel-path' };
    }
    const rec = entry as Record<string, unknown>;
    if (
      typeof rec.relPath !== 'string' ||
      typeof rec.content !== 'string' ||
      !isValidRelPath(rec.relPath)
    ) {
      return { ok: false, reason: 'invalid-rel-path' };
    }
    if (seen.has(rec.relPath)) {
      return { ok: false, reason: 'duplicate-rel-path' };
    }
    seen.add(rec.relPath);
    files.push({ relPath: rec.relPath, content: rec.content });
  }

  if (!seen.has(raw.entryFile)) {
    return { ok: false, reason: 'entry-file-not-in-files' };
  }

  const template: ProjectTemplateV1 = {
    schemaVersion: 1,
    id: raw.id,
    labelKey: raw.labelKey,
    descriptionKey: raw.descriptionKey,
    language: raw.language,
    entryFile: raw.entryFile,
    files,
    license: raw.license,
    ...(raw.dependencies && typeof raw.dependencies === 'object'
      ? { dependencies: raw.dependencies as ProjectTemplateDependencies }
      : {}),
    ...(typeof raw.runCommand === 'string' && raw.runCommand.length > 0
      ? { runCommand: raw.runCommand }
      : {}),
  };
  return { ok: true, template };
}

/**
 * POSIX-style dirname for a validated `relPath`. Returns `''` for
 * top-level files so callers can skip the `mkdir` call when the
 * parent is the root itself.
 */
export function projectTemplateDirname(relPath: string): string {
  const slash = relPath.lastIndexOf('/');
  if (slash <= 0) return '';
  return relPath.slice(0, slash);
}
