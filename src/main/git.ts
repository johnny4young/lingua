/**
 * RL-102 Slice 1 — main-process Git read-only layer.
 *
 * Surface (exposed via `src/main/ipc/git.ts`):
 *
 *   - `detectGit(folderPath)` resolves `{ installed, version?, repoRoot?, branch? }`
 *     for an opened folder. Probes the `git` binary once per main-process
 *     lifetime (mirrors Ruby's `detectRuby` pattern), then runs
 *     `git rev-parse --show-toplevel` + `git rev-parse --abbrev-ref HEAD`
 *     against the folder.
 *   - `getFileStatus(repoRoot, filePath)` returns the per-file porcelain
 *     status as a closed-enum bucket plus insertion / deletion counts.
 *   - `getFileDiff(repoRoot, filePath)` returns the original (`HEAD:<path>`)
 *     and modified (working tree) content for a Monaco diff editor, with
 *     a truncation flag when either side exceeds `MAX_DIFF_BYTES`.
 *
 * Security posture (same shape as `ruby-runner.ts` + `node-runner.ts`):
 *
 *   - `execFileAsync` only — never the shell-evaluating sibling. The
 *     argv is a fixed array with no user-controlled tokens between
 *     `git` and the literal subcommand. The file path that flows into
 *     `git status -- <file>` / `git diff HEAD -- <file>` is validated
 *     to live UNDER `repoRoot` via `path.relative`; `git:diff` also
 *     re-validates that the claimed root is the actual `rev-parse`
 *     top-level before it reads the working-tree side from disk.
 *   - Env: `process.env` is forwarded as-is. Git only needs PATH to
 *     find itself and HOME to read `~/.gitconfig`; both are already in
 *     `process.env`. We intentionally do NOT use `buildNativeRunnerEnv`
 *     here because git is purely read-only and the user-tier env from
 *     RL-011 does not apply (no toolchain to influence).
 *   - Output caps: stdout capped at 64 KiB per side for diffs (the
 *     unified-diff `truncated` flag tells the renderer it must surface
 *     the cap instead of pretending the diff is complete).
 *   - Timeout: 5s per invocation. A hung `git` (network filesystem
 *     stall, repo corruption) cannot block IPC forever.
 *
 * Slice 1 is read-only: there is no `git add`, no `git commit`, no
 * `git checkout`. Slice 2+ adds branch indicator refresh + Slice 3+
 * adds the write surface. Today we read.
 */

import * as childProc from 'node:child_process';
import { existsSync, promises as fsAsync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(childProc.execFile);

/**
 * Per-invocation timeout. Generous enough that a cold-cache `git diff`
 * on a 100k-line file completes; tight enough that a hung filesystem
 * (NFS / SMB / sleep-pinned external drive) does not block IPC.
 */
const GIT_INVOCATION_TIMEOUT_MS = 5_000;

/**
 * Hard cap on each side of the diff payload. A 64 KiB ceiling keeps
 * the Monaco diff editor responsive and prevents a runaway file from
 * blocking the renderer. The renderer surfaces a `truncated` hint when
 * either side hits the cap so the user knows what they are looking at
 * is partial.
 */
const MAX_DIFF_BYTES = 64 * 1024;

/**
 * macOS Electron GUI launches inherit a minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), missing the shell-extended PATH
 * that Homebrew installs into. Apple ships `/usr/bin/git`, but it is
 * the Xcode Command Line Tools stub that prompts the user to install
 * the full toolchain on first invocation — for a smoother UX we also
 * probe the conventional Homebrew + custom install locations and
 * pick the first that exists. The renderer-visible behavior is just
 * "git found / not found"; this walker only changes WHICH binary the
 * exec uses when multiple are installed.
 */
const MAC_GUI_FALLBACK_PATHS = [
  '/opt/homebrew/bin/git',
  '/usr/local/bin/git',
  '/usr/bin/git',
];

export interface GitDetectResult {
  installed: boolean;
  /** `git --version` output, e.g. `git version 2.45.2`. */
  version?: string;
  /** Absolute path of the repo root (a parent of the opened folder). */
  repoRoot?: string;
  /** Current branch name, e.g. `main`. Absent on detached HEAD. */
  branch?: string;
  /** Diagnostic message when `installed === false`. */
  error?: string;
}

export type GitFileStatusKind =
  | 'clean'
  | 'modified'
  | 'untracked'
  | 'unknown';

export interface GitFileStatus {
  status: GitFileStatusKind;
  /** Lines added; absent for `untracked` (no HEAD to diff against). */
  insertions?: number;
  /** Lines removed; absent for `untracked`. */
  deletions?: number;
}

export interface GitFileDiff {
  /** `git show HEAD:<relPath>` content, or empty for untracked / no HEAD. */
  originalContent: string;
  /** Current on-disk content, or empty when the file is deleted. */
  modifiedContent: string;
  /** True when either side hit `MAX_DIFF_BYTES`. */
  truncated: boolean;
}

/**
 * Resolved binary path + version. Cached for the main-process
 * lifetime; the user has to restart the app to pick up a freshly
 * installed git (rare enough that this is acceptable; matches
 * `cachedDetect` in ruby-runner.ts).
 */
interface CachedBinaryProbe {
  binary: string | null;
  version: string | null;
}
let cachedBinary: CachedBinaryProbe | null = null;
/**
 * Reviewer pass — in-flight probe promise so two concurrent boot
 * detects (e.g. one per tab on cold start) share a single
 * `git --version` invocation instead of racing to fill the cache.
 * Cleared on resolve / reject so a future probe (after
 * `resetGitProbeCacheForTests`) re-runs cleanly.
 */
let probeInFlight: Promise<CachedBinaryProbe> | null = null;

async function probeGitBinary(): Promise<CachedBinaryProbe> {
  if (cachedBinary) return cachedBinary;
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async () => {
    // 1. Try whatever PATH resolves first. On every well-configured
    //    machine this is the only path that matters.
    try {
      const { stdout } = await execFileAsync('git', ['--version'], {
        timeout: GIT_INVOCATION_TIMEOUT_MS,
      });
      cachedBinary = { binary: 'git', version: stdout.trim() };
      return cachedBinary;
    } catch {
      // fall through to the fallback walker
    }

    // 2. macOS GUI launches: probe the conventional Homebrew / system
    //    paths. The renderer only sees `installed: true | false`, so
    //    transparently picking up a Homebrew install keeps the UI
    //    correct without a Settings row.
    if (process.platform === 'darwin') {
      for (const candidate of MAC_GUI_FALLBACK_PATHS) {
        if (!existsSync(candidate)) continue;
        try {
          const { stdout } = await execFileAsync(candidate, ['--version'], {
            timeout: GIT_INVOCATION_TIMEOUT_MS,
          });
          cachedBinary = { binary: candidate, version: stdout.trim() };
          return cachedBinary;
        } catch {
          // try the next path
        }
      }
    }

    cachedBinary = { binary: null, version: null };
    return cachedBinary;
  })();
  try {
    return await probeInFlight;
  } finally {
    probeInFlight = null;
  }
}

/**
 * Resolve the binary path + record the probe result. Lazy
 * memoised; called by every `git*` entry point so callers don't have
 * to thread the binary themselves.
 */
async function getGitBinary(): Promise<string | null> {
  const probe = await probeGitBinary();
  return probe.binary;
}

/**
 * Probe whether the opened folder is a git working tree. Returns the
 * repo root (a parent of `folderPath` when the folder sits inside a
 * worktree subdirectory) or `null` when it is not.
 */
async function resolveRepoRoot(
  binary: string,
  folderPath: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      binary,
      ['rev-parse', '--show-toplevel'],
      {
        cwd: folderPath,
        timeout: GIT_INVOCATION_TIMEOUT_MS,
      }
    );
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return null;
    return trimmed;
  } catch {
    // Not a repo, permissions error, or git error. The renderer
    // treats this as "no git posture" and suppresses the pill.
    return null;
  }
}

/**
 * Probe the current branch via `--abbrev-ref HEAD`. Returns `null`
 * on detached HEAD (the command prints `HEAD` literally) or any
 * error — the renderer treats `branch` as optional.
 */
async function resolveBranch(
  binary: string,
  repoRoot: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      binary,
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      {
        cwd: repoRoot,
        timeout: GIT_INVOCATION_TIMEOUT_MS,
      }
    );
    const branch = stdout.trim();
    if (branch.length === 0 || branch === 'HEAD') return null;
    return branch;
  } catch {
    return null;
  }
}

/**
 * Top-level detect entry point. Resolves the binary, repo root, and
 * branch in one IPC roundtrip so the renderer's mount-time call is a
 * single await.
 */
export async function detectGit(folderPath?: string): Promise<GitDetectResult> {
  const probe = await probeGitBinary();
  if (!probe.binary) {
    return {
      installed: false,
      error:
        'Git is not installed. Install it from https://git-scm.com/downloads',
    };
  }
  const version = probe.version ?? undefined;
  if (typeof folderPath !== 'string' || folderPath.length === 0) {
    return { installed: true, ...(version ? { version } : {}) };
  }
  const repoRoot = await resolveRepoRoot(probe.binary, folderPath);
  if (!repoRoot) {
    return { installed: true, ...(version ? { version } : {}) };
  }
  const branch = await resolveBranch(probe.binary, repoRoot);
  return {
    installed: true,
    ...(version ? { version } : {}),
    repoRoot,
    ...(branch ? { branch } : {}),
  };
}

/**
 * Validate that `filePath` lives under `repoRoot`. Without this, a
 * compromised renderer could pass `/etc/passwd` and have main run
 * `git status -- /etc/passwd` from the repo root — git ignores
 * out-of-tree paths, but the path-traversal posture is the same
 * conservative one used in `resolveJsDependencyBatch`.
 *
 * Returns the path RELATIVE to `repoRoot`, suitable for git's `-- <relPath>`
 * argv slot, or `null` when validation fails.
 */
function validateRepoRelativePath(
  repoRoot: string,
  filePath: string
): string | null {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) return null;
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  let absoluteRoot: string;
  let absoluteFile: string;
  try {
    absoluteRoot = path.resolve(repoRoot);
    absoluteFile = path.resolve(filePath);
  } catch {
    return null;
  }
  const relative = path.relative(absoluteRoot, absoluteFile);
  if (relative.length === 0) return null;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

async function realpathOrResolved(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  try {
    return await fsAsync.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function validateGitRepoRoot(
  binary: string,
  repoRoot: string
): Promise<string | null> {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) return null;
  const claimedRoot = path.resolve(repoRoot);
  const resolvedRoot = await resolveRepoRoot(binary, claimedRoot);
  if (!resolvedRoot) return null;
  const [claimedReal, resolvedReal] = await Promise.all([
    realpathOrResolved(claimedRoot),
    realpathOrResolved(resolvedRoot),
  ]);
  if (claimedReal !== resolvedReal) return null;
  return claimedRoot;
}

/**
 * Parse `git diff --numstat HEAD -- <file>` output to extract
 * insertion / deletion counts. Returns `{ insertions: 0, deletions: 0 }`
 * when the file has no diff (clean) or when parsing fails (graceful
 * degradation — the renderer falls back to the porcelain status).
 *
 * Example numstat line: `5\t3\tsrc/main/git.ts` → insertions=5, deletions=3.
 * Binary files show `-\t-\t<file>` → both default to 0.
 */
function parseNumstat(stdout: string): {
  insertions: number;
  deletions: number;
} {
  const line = stdout.split('\n').find((l) => l.trim().length > 0);
  if (!line) return { insertions: 0, deletions: 0 };
  const parts = line.split('\t');
  if (parts.length < 2) return { insertions: 0, deletions: 0 };
  const ins = Number.parseInt(parts[0] ?? '', 10);
  const del = Number.parseInt(parts[1] ?? '', 10);
  return {
    insertions: Number.isFinite(ins) ? ins : 0,
    deletions: Number.isFinite(del) ? del : 0,
  };
}

/**
 * Resolve the porcelain status for `filePath`. Used by the renderer's
 * watcher-driven hook to flip the chip color.
 */
export async function getFileStatus(
  repoRoot: string,
  filePath: string
): Promise<GitFileStatus> {
  const binary = await getGitBinary();
  if (!binary) return { status: 'unknown' };
  const relative = validateRepoRelativePath(repoRoot, filePath);
  if (!relative) return { status: 'unknown' };
  try {
    // `--porcelain=v1` is the stable, parser-friendly format; `-z`
    // would use NUL separators but the single-file query already
    // returns at most one record, so the standard newline output is
    // simpler to consume.
    const { stdout } = await execFileAsync(
      binary,
      ['status', '--porcelain=v1', '--', relative],
      {
        cwd: repoRoot,
        timeout: GIT_INVOCATION_TIMEOUT_MS,
      }
    );
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      return { status: 'clean', insertions: 0, deletions: 0 };
    }
    // First two characters: X = staged status, Y = worktree status.
    // `??` is the universal untracked marker.
    const prefix = trimmed.slice(0, 2);
    if (prefix === '??') {
      return { status: 'untracked' };
    }
    // Anything else with a porcelain line means "tracked + changed
    // in some way (modified, deleted, renamed, added)". Bucket all
    // of these as `modified` for Slice 1 — Slice 2 can split them.
    const counts = await getNumstatForFile(binary, repoRoot, relative);
    return { status: 'modified', ...counts };
  } catch {
    return { status: 'unknown' };
  }
}

async function getNumstatForFile(
  binary: string,
  repoRoot: string,
  relative: string
): Promise<{ insertions: number; deletions: number }> {
  try {
    const { stdout } = await execFileAsync(
      binary,
      ['diff', '--numstat', 'HEAD', '--', relative],
      {
        cwd: repoRoot,
        timeout: GIT_INVOCATION_TIMEOUT_MS,
      }
    );
    return parseNumstat(stdout);
  } catch {
    return { insertions: 0, deletions: 0 };
  }
}

/**
 * Resolve the diff payload for `filePath`. Returns both sides as
 * strings so the renderer can feed Monaco's diff editor directly
 * (Monaco computes the visual diff client-side from the two strings;
 * we don't need to ship unified-diff hunks across the IPC boundary).
 *
 * For untracked files: `originalContent` is empty (no HEAD entry).
 * For deleted files: `modifiedContent` is empty (no disk entry).
 * For binary files: both sides come back empty + `truncated: true`
 *   so the renderer surfaces a "binary diff" placeholder instead of
 *   rendering garbage bytes.
 */
export async function getFileDiff(
  repoRoot: string,
  filePath: string
): Promise<GitFileDiff> {
  const binary = await getGitBinary();
  if (!binary) {
    return { originalContent: '', modifiedContent: '', truncated: false };
  }
  const relative = validateRepoRelativePath(repoRoot, filePath);
  if (!relative) {
    return { originalContent: '', modifiedContent: '', truncated: false };
  }
  const trustedRepoRoot = await validateGitRepoRoot(binary, repoRoot);
  if (!trustedRepoRoot) {
    return { originalContent: '', modifiedContent: '', truncated: false };
  }

  const [originalContent, originalTruncated] = await readHeadVersion(
    binary,
    trustedRepoRoot,
    relative
  );
  const [modifiedContent, modifiedTruncated] = await readWorkingTreeVersion(
    trustedRepoRoot,
    relative
  );

  return {
    originalContent,
    modifiedContent,
    truncated: originalTruncated || modifiedTruncated,
  };
}

/**
 * Read `git show HEAD:<relPath>` capped at `MAX_DIFF_BYTES`. The
 * second tuple member is `true` when the cap was hit.
 *
 * Capping post-execFile is safe because Node's `execFile` enforces
 * `maxBuffer` (default 1 MiB). We override to `MAX_DIFF_BYTES + 1`
 * to differentiate "fit in cap" vs "exceeded cap" without paying
 * the full file size when a 100 MiB file is requested.
 */
async function readHeadVersion(
  binary: string,
  repoRoot: string,
  relative: string
): Promise<[string, boolean]> {
  try {
    const { stdout } = await execFileAsync(
      binary,
      ['show', `HEAD:${relative}`],
      {
        cwd: repoRoot,
        timeout: GIT_INVOCATION_TIMEOUT_MS,
        maxBuffer: MAX_DIFF_BYTES + 1,
      }
    );
    if (typeof stdout !== 'string') return ['', false];
    if (stdout.length > MAX_DIFF_BYTES) {
      return [stdout.slice(0, MAX_DIFF_BYTES), true];
    }
    return [stdout, false];
  } catch (err) {
    // `git show` exits non-zero when the path is not in HEAD
    // (untracked) or the `maxBuffer` triggered (binary / huge file).
    // On maxBuffer, Node attaches the partial stdout to the error;
    // keep that capped prefix instead of rendering an empty left side.
    const message = err instanceof Error ? err.message : '';
    const hitBuffer = /maxBuffer/i.test(message);
    if (!hitBuffer || !err || typeof err !== 'object') {
      return ['', hitBuffer];
    }
    const partial = (err as { stdout?: unknown }).stdout;
    const text =
      typeof partial === 'string'
        ? partial
        : Buffer.isBuffer(partial)
          ? partial.toString('utf-8')
          : '';
    return [text.slice(0, MAX_DIFF_BYTES), true];
  }
}

/**
 * Read the working-tree (disk) version capped at `MAX_DIFF_BYTES`.
 * Returns `['', false]` when the file does not exist (deleted) or
 * fails to read.
 */
async function readWorkingTreeVersion(
  repoRoot: string,
  relative: string
): Promise<[string, boolean]> {
  const absolute = path.join(repoRoot, relative);
  try {
    const stat = await fsAsync.lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await fsAsync.readlink(absolute);
      return [
        target.slice(0, MAX_DIFF_BYTES),
        target.length > MAX_DIFF_BYTES,
      ];
    }
    const buf = await fsAsync.readFile(absolute);
    if (buf.includes(0)) return ['', true];
    if (buf.length > MAX_DIFF_BYTES) {
      return [buf.slice(0, MAX_DIFF_BYTES).toString('utf-8'), true];
    }
    return [buf.toString('utf-8'), false];
  } catch {
    return ['', false];
  }
}

/**
 * Test seam — reset cached binary so unit tests can re-probe with a
 * fresh mock without leaking state across cases.
 *
 * NOT exported by the IPC module; main consumers should not call
 * this. Visibility is `export` (rather than internal-only) so the
 * vitest cases can import it without going through a side-channel.
 */
export function resetGitProbeCacheForTests(): void {
  cachedBinary = null;
  probeInFlight = null;
}
