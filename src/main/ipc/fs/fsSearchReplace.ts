import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  readFile,
  readdir,
  rename as renameFs,
  stat as statAsync,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { typedHandle } from '../typedHandle';
import { asRelativePath, type RootId } from '../../../shared/fs/brandedIds';
import {
  coercePositiveLimit,
  isRecord,
  joinRelative,
  resolveOrThrow,
  shouldHide,
} from './fsShared';

/**
 * IT2-A1 — project-wide text search + literal/regex replace handlers,
 * extracted VERBATIM from `fileSystem.ts`. These three handlers are
 * fully self-contained: they close over no mutable module state, only
 * the pure `fsShared` helpers and capability-resolved paths. The
 * `Fs*` option/result shapes are ambient globals from `src/types.d.ts`.
 */
export function registerSearchReplaceHandlers(): void {
  function buildSearchRegex(
    query: string,
    options: Record<string, unknown>
  ): RegExp | null {
    const flags = `g${options.caseSensitive === true ? '' : 'i'}`;
    try {
      return options.regex === true
        ? new RegExp(query, flags)
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return null;
    }
  }

  function replacementForMatch(
    matchedText: string,
    singleMatchRegex: RegExp,
    replacement: string,
    regexMode: boolean
  ): string {
    return regexMode
      ? matchedText.replace(singleMatchRegex, replacement)
      : replacement;
  }

  function replaceAllMatches(
    content: string,
    re: RegExp,
    replacement: string,
    regexMode: boolean
  ): string {
    if (regexMode) {
      return content.replace(re, replacement);
    }
    return content.replace(re, () => replacement);
  }

  async function walkProject(
    rootAbsolutePath: string,
    rootRelativePath: string,
    onFile: (
      absolutePath: string,
      relativePath: string
    ) => Promise<boolean | void>,
    maxFilesScanned: number
  ): Promise<void> {
    let filesScanned = 0;
    async function walk(
      dirPath: string,
      currentRelative: string
    ): Promise<boolean> {
      if (filesScanned >= maxFilesScanned) return false;
      let entries;
      try {
        entries = await readdir(dirPath, { withFileTypes: true });
      } catch {
        return true;
      }
      for (const entry of entries) {
        if (filesScanned >= maxFilesScanned) return false;
        if (shouldHide(entry.name)) continue;
        const entryPath = path.join(dirPath, entry.name);
        const entryRelative = joinRelative(currentRelative, entry.name);
        if (entry.isDirectory()) {
          const cont = await walk(entryPath, entryRelative);
          if (!cont) return false;
          continue;
        }
        if (!entry.isFile()) continue;
        filesScanned += 1;
        const cont = await onFile(entryPath, entryRelative);
        if (cont === false) return false;
      }
      return true;
    }
    await walk(rootAbsolutePath, rootRelativePath);
  }

  typedHandle(
    'fs:searchInFiles',
    async (
      _event,
      rootId: RootId,
      relativePath: string,
      query: string,
      options: FsSearchOptions = {}
    ): Promise<FsSearchResult[]> => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'read'
      );

      if (typeof query !== 'string') return [];
      const safeOptions = isRecord(options) ? options : {};
      const searchText = query;
      if (searchText.length === 0) return [];

      const caseSensitive = safeOptions.caseSensitive === true;
      const maxMatchesPerFile = coercePositiveLimit(
        safeOptions.maxMatchesPerFile,
        20,
        200
      );
      const maxTotalMatches = coercePositiveLimit(
        safeOptions.maxTotalMatches,
        500,
        5_000
      );
      const maxFileSize = coercePositiveLimit(
        safeOptions.maxFileSize,
        1_000_000,
        1_000_000
      );
      const maxFilesScanned = coercePositiveLimit(
        safeOptions.maxFilesScanned,
        5_000,
        20_000
      );

      const needle = caseSensitive ? searchText : searchText.toLowerCase();
      const results: FsSearchResult[] = [];
      let totalMatches = 0;
      let filesScanned = 0;

      const NUL = String.fromCharCode(0);
      function looksBinary(text: string): boolean {
        const probe = text.slice(0, 1024);
        return probe.includes(NUL);
      }

      async function searchFile(filePath: string, fileRelativePath: string) {
        if (totalMatches >= maxTotalMatches) return;

        let info;
        try {
          info = await statAsync(filePath);
        } catch {
          return; // missing/unreadable file — best-effort
        }

        if (!info.isFile() || info.size > maxFileSize) return;

        let content: string;
        try {
          content = await readFile(filePath, 'utf8');
        } catch {
          return;
        }

        if (looksBinary(content)) return;

        const fileMatches: FsSearchMatch[] = [];
        const lines = content.split(/\r?\n/);

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          if (fileMatches.length >= maxMatchesPerFile) break;
          if (totalMatches + fileMatches.length >= maxTotalMatches) break;

          const rawLine = lines[lineIndex]!;
          const haystack = caseSensitive ? rawLine : rawLine.toLowerCase();
          const column = haystack.indexOf(needle);
          if (column === -1) continue;

          const PREVIEW_BUDGET = 240;
          const previewStart = Math.max(0, column - 80);
          const previewEnd = Math.min(rawLine.length, previewStart + PREVIEW_BUDGET);
          const preview = rawLine.slice(previewStart, previewEnd);

          fileMatches.push({
            line: lineIndex + 1,
            column: column + 1,
            preview,
            matchStart: column - previewStart,
            matchEnd: column - previewStart + searchText.length,
          });
        }

        if (fileMatches.length > 0) {
          results.push({
            relativePath: asRelativePath(fileRelativePath),
            matches: fileMatches,
          });
          totalMatches += fileMatches.length;
        }
      }

      async function walk(dirPath: string, currentRelative: string) {
        if (totalMatches >= maxTotalMatches || filesScanned >= maxFilesScanned) {
          return;
        }

        let entries;
        try {
          entries = await readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (totalMatches >= maxTotalMatches || filesScanned >= maxFilesScanned) {
            return;
          }
          if (shouldHide(entry.name)) continue;

          const entryPath = path.join(dirPath, entry.name);
          const entryRelative = joinRelative(currentRelative, entry.name);

          if (entry.isDirectory()) {
            await walk(entryPath, entryRelative);
            continue;
          }

          if (!entry.isFile()) continue;

          filesScanned += 1;
          await searchFile(entryPath, entryRelative);
        }
      }

      await walk(absolutePath, relativePath);
      return results;
    }
  );

  typedHandle(
    'fs:replaceInFiles',
    async (
      _event,
      rootId: RootId,
      relativePath: string,
      query: string,
      replacement: string,
      options: FsReplaceOptions = {}
    ): Promise<FsReplaceResult[]> => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'read'
      );
      if (typeof query !== 'string' || typeof replacement !== 'string') {
        return [];
      }
      if (!query || query.length === 0) return [];

      const safeOptions = isRecord(options) ? options : {};
      const regexMode = safeOptions.regex === true;
      const re = buildSearchRegex(query, safeOptions);
      if (!re) return [];

      const maxMatchesPerFile = coercePositiveLimit(
        safeOptions.maxMatchesPerFile,
        20,
        200
      );
      const maxTotalMatches = coercePositiveLimit(
        safeOptions.maxTotalMatches,
        500,
        5_000
      );
      const maxFileSize = coercePositiveLimit(
        safeOptions.maxFileSize,
        1_000_000,
        1_000_000
      );
      const maxFilesScanned = coercePositiveLimit(
        safeOptions.maxFilesScanned,
        5_000,
        20_000
      );
      const perLineTimeoutMs = coercePositiveLimit(
        safeOptions.perLineTimeoutMs,
        50,
        250
      );

      const results: FsReplaceResult[] = [];
      let totalMatches = 0;

      const NUL = String.fromCharCode(0);
      function looksBinary(text: string): boolean {
        const probe = text.slice(0, 1024);
        return probe.includes(NUL);
      }

      await walkProject(
        absolutePath,
        relativePath,
        async (filePath, fileRelativePath) => {
          if (totalMatches >= maxTotalMatches) return false;
          let info;
          try {
            info = await statAsync(filePath);
          } catch {
            return true;
          }
          if (!info.isFile() || info.size > maxFileSize) return true;
          let content: string;
          try {
            content = await readFile(filePath, 'utf8');
          } catch {
            return true;
          }
          if (looksBinary(content)) return true;

          const fileMatches: FsReplaceMatch[] = [];
          const lines = content.split(/\r?\n/);
          let fileTimedOut = false;
          const fileDeadline = Date.now() + perLineTimeoutMs * lines.length;
          // RL-024 Slice 2 — extra cap beyond the per-file deadline.
          // `String.prototype.matchAll` runs synchronously per line; a
          // single catastrophic-backtracking pattern (e.g. `(a+)+$`
          // against a megabyte-wide minified line) blocks the Node
          // event loop until the regex returns. The per-file deadline
          // is checked BETWEEN lines, not inside `matchAll`, so lines
          // larger than this threshold are skipped to bound the
          // regex's worst case. Reviewer-flagged HIGH.
          const MAX_LINE_BYTES = 200_000;

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (fileMatches.length >= maxMatchesPerFile) break;
            if (totalMatches + fileMatches.length >= maxTotalMatches) break;
            if (Date.now() > fileDeadline) {
              fileTimedOut = true;
              break;
            }
            const rawLine = lines[lineIndex]!;
            if (rawLine.length > MAX_LINE_BYTES) {
              // Treat over-long lines as if they had no match. Surfacing
              // this through `regexTimedOut` is honest because the
              // failure mode is identical: the file's preview is
              // incomplete for the user.
              fileTimedOut = true;
              continue;
            }
            // RL-024 Slice 2 fold C — `matchAll` returns an iterator
            // so we never call the `.exec` method directly. The `g`
            // flag is required for matchAll and already set by
            // `buildSearchRegex`.
            const matches: RegExpMatchArray[] = [];
            let matchCount = 0;
            for (const m of rawLine.matchAll(re)) {
              matches.push(m);
              matchCount += 1;
              if (matchCount >= 50) break;
            }
            const singleMatchRegex = new RegExp(
              re.source,
              re.flags.replace('g', '')
            );
            for (const m of matches) {
              if (fileMatches.length >= maxMatchesPerFile) break;
              if (typeof m.index !== 'number') continue;
              const PREVIEW_BUDGET = 240;
              const previewStart = Math.max(0, m.index - 80);
              const previewEnd = Math.min(
                rawLine.length,
                previewStart + PREVIEW_BUDGET
              );
              const preview = rawLine.slice(previewStart, previewEnd);
              const matchedText = m[0]!;
              const singleReplacement = replacementForMatch(
                matchedText,
                singleMatchRegex,
                replacement,
                regexMode
              );
              // RL-024 Slice 2 — substitute ONLY this match's text in
              // place. The previous implementation called
              // `rawLine.replace(re, replacement)` (global) and sliced
              // the result with the original line's offsets, which was
              // incorrect on multi-match lines because earlier
              // substitutions shift the byte positions of later ones.
              // Reviewer-flagged HIGH.
              const replacedLine =
                rawLine.slice(0, m.index) +
                singleReplacement +
                rawLine.slice(m.index + matchedText.length);
              const replacedPreviewEnd = Math.min(
                replacedLine.length,
                previewStart + PREVIEW_BUDGET
              );
              const replacedPreview = replacedLine.slice(
                previewStart,
                replacedPreviewEnd
              );
              fileMatches.push({
                line: lineIndex + 1,
                column: m.index + 1,
                preview,
                matchStart: m.index - previewStart,
                matchEnd: m.index - previewStart + matchedText.length,
                replacedPreview,
                replacement: singleReplacement,
              });
            }
          }

          if (fileMatches.length > 0) {
            results.push({
              relativePath: asRelativePath(fileRelativePath),
              matches: fileMatches,
              ...(fileTimedOut ? { regexTimedOut: true } : {}),
            });
            totalMatches += fileMatches.length;
          } else if (fileTimedOut) {
            results.push({
              relativePath: asRelativePath(fileRelativePath),
              matches: [],
              regexTimedOut: true,
            });
          }
          return totalMatches < maxTotalMatches;
        },
        maxFilesScanned
      );

      return results;
    }
  );

  typedHandle(
    'fs:applyReplaceInFile',
    async (
      _event,
      rootId: RootId,
      relativePath: string,
      query: string,
      replacement: string,
      options: FsReplaceOptions = {}
    ): Promise<FsApplyReplaceResult> => {
      const { absolutePath } = await resolveOrThrow(
        rootId,
        relativePath,
        'write'
      );
      if (typeof query !== 'string' || typeof replacement !== 'string') {
        return { ok: false, replaced: 0, reason: 'unsupported' };
      }
      if (!query || query.length === 0) {
        return { ok: false, replaced: 0, reason: 'no-matches' };
      }
      const safeOptions = isRecord(options) ? options : {};
      const regexMode = safeOptions.regex === true;
      const re = buildSearchRegex(query, safeOptions);
      if (!re) return { ok: false, replaced: 0, reason: 'invalid-regex' };

      const maxFileSize = coercePositiveLimit(
        safeOptions.maxFileSize,
        1_000_000,
        1_000_000
      );
      const NUL = String.fromCharCode(0);

      let info;
      try {
        info = await statAsync(absolutePath);
      } catch {
        return { ok: false, replaced: 0, reason: 'read-error' };
      }
      if (!info.isFile()) {
        return { ok: false, replaced: 0, reason: 'read-error' };
      }
      if (info.size > maxFileSize) {
        return { ok: false, replaced: 0, reason: 'too-large' };
      }

      let content: string;
      try {
        content = await readFile(absolutePath, 'utf8');
      } catch {
        return { ok: false, replaced: 0, reason: 'read-error' };
      }
      if (content.slice(0, 1024).includes(NUL)) {
        return { ok: false, replaced: 0, reason: 'binary' };
      }

      // Count matches via matchAll iterator (avoids the .exec API).
      let replaced = 0;
      for (const _ of content.matchAll(re)) {
        replaced += 1;
        if (replaced > 100_000) break; // hard cap defense
        void _;
      }
      if (replaced === 0) {
        return { ok: false, replaced: 0, reason: 'no-matches' };
      }

      const next = replaceAllMatches(
        content,
        new RegExp(re.source, re.flags),
        replacement,
        regexMode
      );

      // Atomic write: tmpfile in same directory + rename. Same-FS
      // rename is POSIX-atomic; Windows AV can lock the target, so
      // retry up to 3 times with exponential backoff.
      const dir = path.dirname(absolutePath);
      const base = path.basename(absolutePath);
      const tmpPath = path.join(
        dir,
        `.${base}.tmp-${randomUUID().slice(0, 8)}`
      );
      try {
        await writeFile(tmpPath, next, 'utf8');
      } catch {
        try {
          await unlink(tmpPath);
        } catch {
          /* best-effort */
        }
        return { ok: false, replaced: 0, reason: 'write-error' };
      }

      const renameWithRetry = async (): Promise<boolean> => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await renameFs(tmpPath, absolutePath);
            return true;
          } catch {
            await new Promise((r) =>
              setTimeout(r, [10, 100, 1000][attempt] ?? 1000)
            );
          }
        }
        return false;
      };
      const renamed = await renameWithRetry();
      if (!renamed) {
        try {
          await unlink(tmpPath);
        } catch {
          /* best-effort */
        }
        return { ok: false, replaced: 0, reason: 'write-error' };
      }
      return { ok: true, replaced };
    }
  );
}
