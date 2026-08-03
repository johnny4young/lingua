import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { asRelativePath } from '../../../shared/fs/brandedIds';
import { joinRelative, shouldHide } from './fsShared';

const PREVIEW_BUDGET = 240;
const PREVIEW_LEADING_CONTEXT = 80;
const RIPGREP_TIMEOUT_MS = 30_000;
const RIPGREP_FILES_PER_CHUNK = 512;
const RIPGREP_ARG_BUDGET = process.platform === 'win32' ? 24_000 : 96_000;
const FILE_PROBE_BYTES = 4_096;
const FILE_PROBE_CONCURRENCY = 16;

interface ProjectTextSearchLimits {
  maxMatchesPerFile: number;
  maxTotalMatches: number;
  maxFileSize: number;
  maxFilesScanned: number;
}

export interface ProjectTextSearchRequest extends ProjectTextSearchLimits {
  searchRootAbsolutePath: string;
  rootRelativePath: string;
  query: string;
  caseSensitive: boolean;
  signal?: AbortSignal;
  ripgrepCandidates?: readonly string[];
}

interface SearchFile {
  absolutePath: string;
  relativePath: string;
  searchPath: string;
}

interface RipgrepText {
  text?: string;
  bytes?: string;
}

interface RipgrepMatchMessage {
  type?: string;
  data?: {
    path?: RipgrepText;
    lines?: RipgrepText;
    line_number?: number;
    submatches?: Array<{
      start?: number;
      end?: number;
    }>;
  };
}

interface RipgrepAttempt {
  ok: boolean;
  aborted: boolean;
  results: FsSearchResult[];
}

interface RipgrepChunkResult {
  ok: boolean;
  aborted: boolean;
  capped: boolean;
}

function executableName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

function platformPackageName(): string | null {
  if (
    !['darwin', 'linux', 'win32'].includes(process.platform) ||
    !['arm', 'arm64', 'ia32', 'ppc64', 'riscv64', 's390x', 'x64'].includes(process.arch)
  ) {
    return null;
  }
  return `ripgrep-${process.platform}-${process.arch}`;
}

/**
 * Resolve only trusted, deterministic locations in packaged builds. Development
 * additionally accepts the installed package binary and PATH so contributor
 * launches can exercise the fast path before a full desktop bundle exists.
 */
function resolveRipgrepCandidates(): string[] {
  const binaryName = executableName();
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  if (app.isPackaged === true) {
    return resourcesPath ? [path.join(resourcesPath, 'ripgrep', binaryName)] : [];
  }

  const candidates = [
    path.join(
      process.cwd(),
      '.vite',
      'native',
      'ripgrep',
      `${process.platform}-${process.arch}`,
      binaryName
    ),
  ];
  const packageName = platformPackageName();
  if (packageName) {
    candidates.push(
      path.join(process.cwd(), 'node_modules', '@vscode', packageName, 'bin', binaryName)
    );
  }
  candidates.push(binaryName);
  return candidates;
}

async function collectSearchFiles(
  searchRootAbsolutePath: string,
  rootRelativePath: string,
  maxFilesScanned: number,
  signal?: AbortSignal
): Promise<SearchFile[]> {
  const files: SearchFile[] = [];

  async function walk(directoryPath: string, currentRelativePath: string): Promise<void> {
    if (signal?.aborted || files.length >= maxFilesScanned) return;

    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (signal?.aborted || files.length >= maxFilesScanned) return;
      if (shouldHide(entry.name)) continue;

      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = joinRelative(currentRelativePath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;

      files.push({
        absolutePath,
        relativePath,
        searchPath: path.relative(searchRootAbsolutePath, absolutePath),
      });
    }
  }

  await walk(searchRootAbsolutePath, rootRelativePath);
  return files;
}

function buildPreview(
  rawLine: string,
  matchStart: number,
  matchEnd: number
): Omit<FsSearchMatch, 'line' | 'column'> {
  const previewStart = Math.max(0, matchStart - PREVIEW_LEADING_CONTEXT);
  const previewEnd = Math.min(rawLine.length, previewStart + PREVIEW_BUDGET);
  return {
    preview: rawLine.slice(previewStart, previewEnd),
    matchStart: matchStart - previewStart,
    matchEnd: matchEnd - previewStart,
  };
}

function looksBinary(text: string): boolean {
  return text.slice(0, 1024).includes(String.fromCharCode(0));
}

function literalCaseInsensitiveRegex(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
}

async function filterSearchableFiles(
  files: readonly SearchFile[],
  maxFileSize: number,
  signal?: AbortSignal
): Promise<SearchFile[]> {
  const accepted = new Array<boolean>(files.length).fill(false);
  let nextIndex = 0;

  async function probeFiles(): Promise<void> {
    while (!signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= files.length) return;

      const file = files[index]!;
      let info;
      try {
        info = await stat(file.absolutePath);
      } catch {
        continue;
      }
      if (!info.isFile() || info.size > maxFileSize) continue;

      let handle;
      try {
        handle = await open(file.absolutePath, 'r');
        const probe = Buffer.allocUnsafe(Math.min(FILE_PROBE_BYTES, Math.max(1, info.size)));
        const { bytesRead } = await handle.read(probe, 0, probe.byteLength, 0);
        accepted[index] = !probe.subarray(0, bytesRead).includes(0);
      } catch {
        accepted[index] = false;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FILE_PROBE_CONCURRENCY, files.length) }, () => probeFiles())
  );
  if (signal?.aborted) return [];
  return files.filter((_, index) => accepted[index]);
}

async function searchFilesWithJavaScript(
  files: readonly SearchFile[],
  request: ProjectTextSearchRequest
): Promise<FsSearchResult[]> {
  const caseInsensitiveRegex = request.caseSensitive
    ? null
    : literalCaseInsensitiveRegex(request.query);
  const results: FsSearchResult[] = [];
  let totalMatches = 0;

  for (const file of files) {
    if (request.signal?.aborted || totalMatches >= request.maxTotalMatches) {
      break;
    }

    let info;
    try {
      info = await stat(file.absolutePath);
    } catch {
      continue;
    }
    if (!info.isFile() || info.size > request.maxFileSize) continue;

    let content: string;
    try {
      content = await readFile(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (looksBinary(content)) continue;

    const matches: FsSearchMatch[] = [];
    const lines = content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (
        request.signal?.aborted ||
        matches.length >= request.maxMatchesPerFile ||
        totalMatches + matches.length >= request.maxTotalMatches
      ) {
        break;
      }

      const rawLine = lines[lineIndex]!;
      const caseInsensitiveMatch = caseInsensitiveRegex?.exec(rawLine);
      const column = request.caseSensitive
        ? rawLine.indexOf(request.query)
        : (caseInsensitiveMatch?.index ?? -1);
      if (column === -1) continue;
      const matchLength = request.caseSensitive
        ? request.query.length
        : (caseInsensitiveMatch?.[0].length ?? request.query.length);

      matches.push({
        line: lineIndex + 1,
        column: column + 1,
        ...buildPreview(rawLine, column, column + matchLength),
      });
    }

    if (matches.length > 0) {
      results.push({
        relativePath: asRelativePath(file.relativePath),
        matches,
      });
      totalMatches += matches.length;
    }
  }

  return request.signal?.aborted ? [] : results;
}

function chunkSearchFiles(files: readonly SearchFile[]): SearchFile[][] {
  const chunks: SearchFile[][] = [];
  let chunk: SearchFile[] = [];
  let argumentCharacters = 0;

  for (const file of files) {
    const nextCharacters = file.searchPath.length + 1;
    if (
      chunk.length > 0 &&
      (chunk.length >= RIPGREP_FILES_PER_CHUNK ||
        argumentCharacters + nextCharacters > RIPGREP_ARG_BUDGET)
    ) {
      chunks.push(chunk);
      chunk = [];
      argumentCharacters = 0;
    }
    chunk.push(file);
    argumentCharacters += nextCharacters;
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function decodeRipgrepText(value: RipgrepText | undefined): string | null {
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.bytes === 'string') {
    return Buffer.from(value.bytes, 'base64').toString('utf8');
  }
  return null;
}

function stripLineEnding(line: string): string {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\n')) return line.slice(0, -1);
  return line;
}

function byteOffsetToStringIndex(text: string, byteOffset: number): number {
  return Buffer.from(text, 'utf8').subarray(0, byteOffset).toString('utf8').length;
}

function orderedResults(
  files: readonly SearchFile[],
  matchesByPath: ReadonlyMap<string, FsSearchMatch[]>
): FsSearchResult[] {
  const results: FsSearchResult[] = [];
  for (const file of files) {
    const matches = matchesByPath.get(file.absolutePath);
    if (!matches || matches.length === 0) continue;
    results.push({
      relativePath: asRelativePath(file.relativePath),
      matches,
    });
  }
  return results;
}

function runRipgrepChunk(
  binaryPath: string,
  files: readonly SearchFile[],
  request: ProjectTextSearchRequest,
  matchesByPath: Map<string, FsSearchMatch[]>,
  totalMatches: { value: number },
  timeoutMs: number
): Promise<RipgrepChunkResult> {
  const fileByAbsolutePath = new Map(files.map(file => [path.resolve(file.absolutePath), file]));
  const args = [
    '--no-config',
    '--json',
    '--fixed-strings',
    request.caseSensitive ? '--case-sensitive' : '--ignore-case',
    '--no-ignore',
    '--hidden',
    '--threads',
    '1',
    '--max-count',
    String(request.maxMatchesPerFile),
    '--max-filesize',
    String(request.maxFileSize),
    '--',
    request.query,
    ...files.map(file => file.searchPath),
  ];

  return new Promise(resolve => {
    let settled = false;
    let stdoutBuffer = '';
    let parseFailed = false;
    let capped = false;
    let timedOut = false;
    let aborted = request.signal?.aborted === true;

    const child = spawn(binaryPath, args, {
      cwd: request.searchRootAbsolutePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timeout = setTimeout(
      () => {
        timedOut = true;
        if (!child.killed) child.kill();
      },
      Math.max(1, timeoutMs)
    );

    const finish = (result: RipgrepChunkResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abortSearch);
      resolve(result);
    };

    const stopChild = () => {
      if (!child.killed) child.kill();
    };

    const abortSearch = () => {
      aborted = true;
      stopChild();
    };

    const failParsing = () => {
      parseFailed = true;
      stopChild();
    };

    const parseLine = (line: string) => {
      if (!line || parseFailed || capped || aborted) return;

      let message: RipgrepMatchMessage;
      try {
        message = JSON.parse(line) as RipgrepMatchMessage;
      } catch {
        failParsing();
        return;
      }
      if (message.type !== 'match') return;

      const reportedPath = decodeRipgrepText(message.data?.path);
      const reportedLine = decodeRipgrepText(message.data?.lines);
      const lineNumber = message.data?.line_number;
      const submatch = message.data?.submatches?.[0];
      if (
        reportedPath === null ||
        reportedLine === null ||
        typeof lineNumber !== 'number' ||
        typeof submatch?.start !== 'number' ||
        typeof submatch.end !== 'number'
      ) {
        failParsing();
        return;
      }

      const absolutePath = path.resolve(request.searchRootAbsolutePath, reportedPath);
      const file = fileByAbsolutePath.get(absolutePath);
      if (!file) {
        failParsing();
        return;
      }

      const existingMatches = matchesByPath.get(file.absolutePath) ?? [];
      if (existingMatches.length >= request.maxMatchesPerFile) return;
      if (totalMatches.value >= request.maxTotalMatches) {
        capped = true;
        stopChild();
        return;
      }

      const rawLine = stripLineEnding(reportedLine);
      const matchStart = byteOffsetToStringIndex(rawLine, submatch.start);
      const matchEnd = byteOffsetToStringIndex(rawLine, submatch.end);
      existingMatches.push({
        line: lineNumber,
        column: matchStart + 1,
        ...buildPreview(rawLine, matchStart, matchEnd),
      });
      matchesByPath.set(file.absolutePath, existingMatches);
      totalMatches.value += 1;

      if (totalMatches.value >= request.maxTotalMatches) {
        capped = true;
        stopChild();
      }
    };

    const consumeLines = (flush: boolean) => {
      let lineBreak = stdoutBuffer.indexOf('\n');
      while (lineBreak >= 0) {
        parseLine(stdoutBuffer.slice(0, lineBreak));
        stdoutBuffer = stdoutBuffer.slice(lineBreak + 1);
        lineBreak = stdoutBuffer.indexOf('\n');
      }
      if (flush && stdoutBuffer.length > 0 && !capped) {
        parseLine(stdoutBuffer);
        stdoutBuffer = '';
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      consumeLines(false);
    });
    child.stderr.resume();
    child.once('error', () => {
      finish({ ok: false, aborted, capped: false });
    });
    child.once('close', code => {
      consumeLines(true);
      const successfulExit = code === 0 || code === 1;
      finish({
        ok: !timedOut && !parseFailed && !aborted && (successfulExit || capped),
        aborted,
        capped,
      });
    });

    request.signal?.addEventListener('abort', abortSearch, { once: true });
    if (aborted) stopChild();
  });
}

async function executableExists(candidate: string): Promise<boolean> {
  if (!candidate.includes(path.sep)) return true;
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function searchFilesWithRipgrep(
  binaryPath: string,
  files: readonly SearchFile[],
  request: ProjectTextSearchRequest
): Promise<RipgrepAttempt> {
  if (!(await executableExists(binaryPath))) {
    return { ok: false, aborted: false, results: [] };
  }

  const matchesByPath = new Map<string, FsSearchMatch[]>();
  const totalMatches = { value: 0 };
  const deadline = Date.now() + RIPGREP_TIMEOUT_MS;

  for (const chunk of chunkSearchFiles(files)) {
    if (request.signal?.aborted) {
      return { ok: false, aborted: true, results: [] };
    }

    const chunkResult = await runRipgrepChunk(
      binaryPath,
      chunk,
      request,
      matchesByPath,
      totalMatches,
      deadline - Date.now()
    );
    if (chunkResult.aborted) {
      return { ok: false, aborted: true, results: [] };
    }
    if (!chunkResult.ok) {
      return { ok: false, aborted: false, results: [] };
    }
    if (chunkResult.capped) break;
  }

  return {
    ok: true,
    aborted: false,
    results: orderedResults(files, matchesByPath),
  };
}

/**
 * Search a capability-resolved project subtree. ripgrep is an optimization,
 * never a correctness dependency: any missing, malformed, or failed executable
 * transparently falls back to the bounded JavaScript implementation.
 */
export async function searchProjectText(
  request: ProjectTextSearchRequest
): Promise<FsSearchResult[]> {
  const files = await collectSearchFiles(
    request.searchRootAbsolutePath,
    request.rootRelativePath,
    request.maxFilesScanned,
    request.signal
  );
  if (request.signal?.aborted || files.length === 0) return [];

  const searchableFiles = await filterSearchableFiles(files, request.maxFileSize, request.signal);
  if (request.signal?.aborted || searchableFiles.length === 0) return [];

  const candidates = request.ripgrepCandidates ?? resolveRipgrepCandidates();
  for (const candidate of candidates) {
    try {
      const attempt = await searchFilesWithRipgrep(candidate, searchableFiles, request);
      if (attempt.aborted) return [];
      if (attempt.ok) return attempt.results;
    } catch {
      // A malformed argument or unusable executable is an optimization
      // failure, not a user-visible search failure. Try the next candidate.
    }
  }

  return searchFilesWithJavaScript(searchableFiles, request);
}
