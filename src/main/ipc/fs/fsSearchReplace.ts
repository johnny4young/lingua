import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  chmod,
  readFile,
  readdir,
  rename as renameFs,
  stat as statAsync,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { validatedHandle } from '../typedHandle';
import { asRelativePath, type RootId } from '../../../shared/fs/brandedIds';
import { fsArgs } from './fsArgs';
import {
  coercePositiveLimit,
  isRecord,
  joinRelative,
  resolveOrThrow,
  shouldHide,
} from './fsShared';
import { searchProjectText } from './projectTextSearch';
import {
  createRegexWorker,
  regexHardTimeoutMs,
  RegexTimeoutError,
  type RegexLineMatch,
} from './regexWorker';

/**
 * project-wide text search + literal/regex replace handlers,
 * extracted VERBATIM from `fileSystem.ts`. These three handlers are
 * fully self-contained: they close over no mutable module state, only
 * the pure `fsShared` helpers and capability-resolved paths. The
 * `Fs*` option/result shapes are ambient globals from `src/types.d.ts`.
 */
export function registerSearchReplaceHandlers(): void {
  const activeSearches = new Map<number, AbortController>();

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

  validatedHandle(
    'fs:searchInFiles',
    fsArgs.search,
    async (
      event,
      rootId: RootId,
      relativePath: string,
      query: string,
      options: FsSearchOptions = {}
    ): Promise<FsSearchResult[]> => {
      const senderId = event.sender.id;
      activeSearches.get(senderId)?.abort();

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

      const controller = new AbortController();
      activeSearches.set(senderId, controller);

      try {
        return await searchProjectText({
          searchRootAbsolutePath: absolutePath,
          rootRelativePath: relativePath,
          query: searchText,
          caseSensitive,
          maxMatchesPerFile,
          maxTotalMatches,
          maxFileSize,
          maxFilesScanned,
          signal: controller.signal,
        });
      } finally {
        if (activeSearches.get(senderId) === controller) {
          activeSearches.delete(senderId);
        }
      }
    }
  );

  validatedHandle(
    'fs:replaceInFiles',
    (args) => fsArgs.replace('fs:replaceInFiles', args),
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

      // Escaped literals cannot backtrack catastrophically; user patterns can.
      const regexWorker = regexMode ? createRegexWorker() : null;
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
          // Lines past this length are skipped and reported as timed out
          // rather than handed to the regex engine.
          const MAX_LINE_BYTES = 200_000;
          const MAX_MATCHES_PER_LINE = 50;
          const maxMatches = Math.min(
            maxMatchesPerFile,
            maxTotalMatches - totalMatches
          );
          let rawMatches: RegexLineMatch[];
          let fileTimedOut = false;

          if (regexWorker) {
            try {
              const outcome = await regexWorker.preview(
                {
                  source: re.source,
                  flags: re.flags,
                  replacement,
                  lines,
                  maxMatches,
                  maxMatchesPerLine: MAX_MATCHES_PER_LINE,
                  maxLineLength: MAX_LINE_BYTES,
                  perLineTimeoutMs,
                },
                regexHardTimeoutMs(lines.length, perLineTimeoutMs)
              );
              rawMatches = outcome.matches;
              fileTimedOut = outcome.timedOut;
            } catch (error) {
              if (!(error instanceof RegexTimeoutError)) throw error;
              // The same pattern would stall on the remaining files too.
              results.push({
                relativePath: asRelativePath(fileRelativePath),
                matches: [],
                regexTimedOut: true,
              });
              return false;
            }
          } else {
            rawMatches = [];
            const fileDeadline = Date.now() + perLineTimeoutMs * lines.length;
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
              if (rawMatches.length >= maxMatches) break;
              if (Date.now() > fileDeadline) {
                fileTimedOut = true;
                break;
              }
              const rawLine = lines[lineIndex]!;
              if (rawLine.length > MAX_LINE_BYTES) {
                fileTimedOut = true;
                continue;
              }
              let lineMatches = 0;
              for (const m of rawLine.matchAll(re)) {
                if (rawMatches.length >= maxMatches) break;
                rawMatches.push({
                  lineIndex,
                  index: m.index,
                  text: m[0],
                  replacement,
                });
                lineMatches += 1;
                if (lineMatches >= MAX_MATCHES_PER_LINE) break;
              }
            }
          }

          for (const m of rawMatches) {
            const rawLine = lines[m.lineIndex]!;
            const PREVIEW_BUDGET = 240;
            const previewStart = Math.max(0, m.index - 80);
            const previewEnd = Math.min(
              rawLine.length,
              previewStart + PREVIEW_BUDGET
            );
            const preview = rawLine.slice(previewStart, previewEnd);
            // Substitute only this match so earlier replacements on the
            // same line cannot shift the offsets of later ones.
            const replacedLine =
              rawLine.slice(0, m.index) +
              m.replacement +
              rawLine.slice(m.index + m.text.length);
            const replacedPreviewEnd = Math.min(
              replacedLine.length,
              previewStart + PREVIEW_BUDGET
            );
            fileMatches.push({
              line: m.lineIndex + 1,
              column: m.index + 1,
              preview,
              matchStart: m.index - previewStart,
              matchEnd: m.index - previewStart + m.text.length,
              replacedPreview: replacedLine.slice(previewStart, replacedPreviewEnd),
              replacement: m.replacement,
            });
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
      ).finally(() => regexWorker?.dispose());

      return results;
    }
  );

  validatedHandle(
    'fs:applyReplaceInFile',
    (args) => fsArgs.replace('fs:applyReplaceInFile', args),
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

      const MAX_REPLACEMENTS = 100_000;
      let replaced = 0;
      let next: string;
      if (regexMode) {
        const perLineTimeoutMs = coercePositiveLimit(
          safeOptions.perLineTimeoutMs,
          50,
          250
        );
        const regexWorker = createRegexWorker();
        try {
          ({ replaced, next } = await regexWorker.apply(
            {
              source: re.source,
              flags: re.flags,
              replacement,
              content,
              maxCount: MAX_REPLACEMENTS,
            },
            regexHardTimeoutMs(content.split('\n').length, perLineTimeoutMs)
          ));
        } catch (error) {
          if (error instanceof RegexTimeoutError) {
            return { ok: false, replaced: 0, reason: 'regex-timeout' };
          }
          throw error;
        } finally {
          regexWorker.dispose();
        }
      } else {
        for (const _ of content.matchAll(re)) {
          replaced += 1;
          if (replaced > MAX_REPLACEMENTS) break;
          void _;
        }
        // A function replacer keeps `$` sequences literal.
        next = content.replace(new RegExp(re.source, re.flags), () => replacement);
      }
      if (replaced === 0) {
        return { ok: false, replaced: 0, reason: 'no-matches' };
      }

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
        // The rename swaps in the temp file's inode; chmod undoes the umask.
        const mode = info.mode & 0o777;
        await writeFile(tmpPath, next, { encoding: 'utf8', mode });
        await chmod(tmpPath, mode).catch(() => {});
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
