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
import { existsSync, promises as fsAsync, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';

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

// ---------------------------------------------------------------------------
// RL-102 Slice 2 — `.git/HEAD` watcher + `Reveal in Source Control` action.
// ---------------------------------------------------------------------------

/**
 * Debounce window for the HEAD watcher. Git often touches multiple
 * files during a `checkout` (HEAD, ORIG_HEAD, packed-refs, index);
 * we coalesce rapid watch events into a single resolve. 300 ms is
 * short enough that a sibling-terminal checkout surfaces within one
 * human reaction cycle and long enough to absorb the burst.
 */
const HEAD_WATCH_DEBOUNCE_MS = 300;

/**
 * Restart backoff schedule (ms) for the HEAD watcher. When the
 * filesystem watcher throws (parent dir does not exist, EPERM,
 * permission change), we retry on this schedule and surface a
 * `give-up` payload to the renderer after the last attempt. Chosen
 * so a transient race (e.g. user runs `git init` after opening the
 * folder) resolves on the second attempt; a permanent problem (no
 * `.git` because the project genuinely isn't a repo any more) bows
 * out within ~14 s rather than hot-looping.
 */
const HEAD_WATCH_RESTART_BACKOFF_MS = [1_000, 3_000, 10_000] as const;
const HEAD_WATCH_MAX_RETRIES = HEAD_WATCH_RESTART_BACKOFF_MS.length;

/**
 * Payload broadcast over `git:on-head-changed` when a debounced
 * HEAD change resolves to fresh branch / commit data. `branchChanged`
 * lets the renderer telemetry filter out no-op fires (e.g. `git
 * commit` touches HEAD without changing the branch name).
 */
export interface GitHeadChangePayload {
  repoRoot: string;
  /**
   * Current branch name. `null` explicitly means detached HEAD so
   * renderer caches can clear a previously-known branch.
   */
  branch?: string | null;
  commit?: string;
  branchChanged: boolean;
}

/**
 * Watcher diagnostic payload. Mirrors the shape of `fs:watcher-failed`
 * from RL-087 so the renderer can route it through a unified notice
 * surface.
 */
export interface GitHeadWatcherDiagnostic {
  repoRoot: string;
  reason: 'give-up' | 'resolve-error';
}

/**
 * Disposable handle returned by `watchRepoHead`. Calling `dispose()`
 * is idempotent — repeat calls are safe.
 */
export interface GitHeadWatcher {
  dispose: () => void;
}

interface HeadWatchCallbacks {
  onChange: (payload: GitHeadChangePayload) => void;
  onDiagnostic?: (diagnostic: GitHeadWatcherDiagnostic) => void;
}

/**
 * Resolve the real `.git/HEAD` path for `repoRoot`. Handles the
 * three forms `.git` can take:
 *
 *   1. A real directory at `<repoRoot>/.git` — HEAD is at `.git/HEAD`.
 *   2. A regular file at `<repoRoot>/.git` containing
 *      `gitdir: <abs or rel path to worktree dir>` — used by linked
 *      worktrees. We follow the pointer and HEAD lives at
 *      `<gitdir>/HEAD`. A relative `gitdir:` is resolved against
 *      `repoRoot` (older git versions emit relative paths).
 *   3. Neither exists — the folder is not a repo. Returns `null`.
 *
 * The returned path is always absolute.
 */
export async function resolveRepoHeadPath(
  repoRoot: string
): Promise<string | null> {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) return null;
  let absoluteRoot: string;
  try {
    absoluteRoot = path.resolve(repoRoot);
  } catch {
    return null;
  }
  const dotGit = path.join(absoluteRoot, '.git');
  let stat: import('node:fs').Stats;
  try {
    stat = await fsAsync.stat(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    return path.join(dotGit, 'HEAD');
  }
  if (!stat.isFile()) return null;
  let contents: string;
  try {
    contents = await fsAsync.readFile(dotGit, 'utf-8');
  } catch {
    return null;
  }
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(contents);
  if (!match) return null;
  const pointer = match[1] ?? '';
  if (pointer.length === 0) return null;
  const resolvedDir = path.isAbsolute(pointer)
    ? pointer
    : path.resolve(absoluteRoot, pointer);
  return path.join(resolvedDir, 'HEAD');
}

/**
 * Re-resolve `{ branch, commit }` for a repo root. Reuses the
 * existing `resolveBranch` helper for the branch piece and adds a
 * single rev-parse spawn for the commit hash. Returns `null` when
 * the binary is missing — the caller treats that as "give up this
 * round, try next watch event."
 */
async function resolveHeadSummary(
  repoRoot: string
): Promise<{ branch?: string; commit?: string } | null> {
  const binary = await getGitBinary();
  if (!binary) return null;
  const branch = await resolveBranch(binary, repoRoot);
  let commit: string | undefined;
  // Reuse the same execFileAsync envelope the rest of the module
  // uses (shell: false, 5s timeout, no shell evaluation). The argv
  // is a fixed array — no user-controlled tokens between `git` and
  // the literal subcommand. SAFE per Slice 1 security posture.
  const runner = execFileAsync;
  try {
    const { stdout } = await runner(binary, ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      timeout: GIT_INVOCATION_TIMEOUT_MS,
    });
    const trimmed = stdout.trim();
    if (trimmed.length > 0 && trimmed !== 'HEAD') commit = trimmed;
  } catch {
    // Detached HEAD or transient — keep commit undefined.
  }
  return {
    ...(branch ? { branch } : {}),
    ...(commit ? { commit } : {}),
  };
}

/**
 * Watch `.git/HEAD` and emit `{ branch, commit, branchChanged }` on
 * each settled change. The watcher follows linked-worktree pointer
 * files so a checkout inside the worktree also surfaces.
 *
 * Lifecycle:
 *
 *   1. Resolve the real HEAD path. On failure → return a disposable
 *      that surfaces a `resolve-error` diagnostic and sits idle.
 *   2. Watch the PARENT directory of HEAD (file-level `fs.watch` is
 *      unreliable on macOS when git atomic-rewrites HEAD via rename;
 *      the parent-dir + basename filter is the documented Node
 *      workaround).
 *   3. On each watch event whose filename is `HEAD` (or whose
 *      filename is absent — some platforms drop it under load),
 *      debounce `HEAD_WATCH_DEBOUNCE_MS`. After the debounce, resolve
 *      the fresh summary and emit `onChange`.
 *   4. If the watcher itself throws (parent dir vanished — e.g.
 *      `rm -rf .git`), retry on the exponential backoff schedule.
 *      After `HEAD_WATCH_MAX_RETRIES` failures we surface a
 *      `give-up` diagnostic and park.
 *
 * The returned `dispose()` clears the debounce, the backoff timer,
 * and stops the watcher. Idempotent.
 */
export async function watchRepoHead(
  repoRoot: string,
  callbacks: HeadWatchCallbacks
): Promise<GitHeadWatcher> {
  const headPath = await resolveRepoHeadPath(repoRoot);
  let cancelled = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let watcher: import('node:fs').FSWatcher | null = null;
  let retryCount = 0;
  let lastBranch: string | undefined;
  let initialised = false;

  const surfaceDiagnostic = (
    reason: GitHeadWatcherDiagnostic['reason']
  ): void => {
    callbacks.onDiagnostic?.({ repoRoot, reason });
  };

  const clearTimers = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const dispose = (): void => {
    if (cancelled) return;
    cancelled = true;
    clearTimers();
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* watcher already closed */
      }
      watcher = null;
    }
  };

  if (!headPath) {
    surfaceDiagnostic('resolve-error');
    return { dispose };
  }

  const headDir = path.dirname(headPath);
  const headBasename = path.basename(headPath);

  const resolveAndEmit = async (): Promise<void> => {
    if (cancelled) return;
    const summary = await resolveHeadSummary(repoRoot);
    if (cancelled || !summary) return;
    const branchChanged = initialised ? summary.branch !== lastBranch : false;
    lastBranch = summary.branch;
    initialised = true;
    callbacks.onChange({
      repoRoot,
      branchChanged,
      branch: summary.branch ?? null,
      ...(summary.commit ? { commit: summary.commit } : {}),
    });
  };

  const scheduleResolve = (): void => {
    if (cancelled) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void resolveAndEmit();
    }, HEAD_WATCH_DEBOUNCE_MS);
  };

  const scheduleRestart = (): void => {
    if (cancelled) return;
    if (retryCount >= HEAD_WATCH_MAX_RETRIES) {
      surfaceDiagnostic('give-up');
      return;
    }
    const delay = HEAD_WATCH_RESTART_BACKOFF_MS[retryCount] ?? 10_000;
    retryCount += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      startWatcher();
    }, delay);
  };

  const startWatcher = (): void => {
    if (cancelled) return;
    try {
      // Top-level `fsWatch` import lets the test harness mock the
      // module via `vi.mock('node:fs', …)` like every other main
      // module that wraps node:fs primitives — the reviewer pass
      // pointed out the previous lazy-require pattern was both
      // non-idiomatic and untestable against the actual watch path.
      watcher = fsWatch(headDir, (_eventType, filename) => {
        // Some platforms drop the filename in the callback under
        // load (RL-087 §) — when absent, schedule the resolve
        // unconditionally and let the diff vs `lastBranch` decide
        // whether to fire. When present, only fire for `HEAD` to
        // avoid double-firing on sibling-file noise (`ORIG_HEAD`,
        // `FETCH_HEAD`, `packed-refs`).
        if (filename && filename !== headBasename) return;
        scheduleResolve();
      });
      watcher.on('error', () => {
        if (cancelled) return;
        try {
          watcher?.close();
        } catch {
          /* ignored */
        }
        watcher = null;
        scheduleRestart();
      });
      // Reset the retry counter on a successful start — a previously
      // recovered watcher gets a fresh quota when it next fails.
      retryCount = 0;
    } catch {
      scheduleRestart();
      return;
    }
    // Emit an initial summary so the renderer's branch indicator
    // refreshes immediately on subscription (covers the case where
    // the project was reopened mid-checkout). No `branchChanged`
    // event fires for the first emit — `initialised` is false until
    // the first resolveAndEmit completes.
    void resolveAndEmit();
  };

  startWatcher();
  return { dispose };
}

/**
 * Reveal the repo root in the OS file manager. Returns `true` when
 * the shell handled the open, `false` when it refused (path
 * disappeared between context-menu open and click, or the OS
 * rejected the request).
 *
 * Uses `shell.openPath` (same primitive `fs:reveal-in-finder` uses)
 * rather than probing for an installed Source Control GUI client.
 * Cross-platform SC-client detection is brittle (different bundle
 * ids on Linux / Windows, fingerprinting risk per `ANTI_FEATURES.md`
 * §A-008) — opening the working tree in Finder / Explorer is the
 * generic action a developer expects.
 */
export async function revealRepo(repoRoot: string): Promise<boolean> {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) return false;
  let absoluteRoot: string;
  try {
    absoluteRoot = path.resolve(repoRoot);
  } catch {
    return false;
  }
  // Defense in depth — make sure the path still exists. Slice 1's
  // `validateGitRepoRoot` re-runs `git rev-parse --show-toplevel` on
  // every diff call; reveal is a cheaper action so we settle for an
  // `fs.stat` existence probe.
  try {
    const stat = await fsAsync.stat(absoluteRoot);
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }
  try {
    const error = await shell.openPath(absoluteRoot);
    // `openPath` returns an empty string on success and an OS-level
    // error string on failure.
    return typeof error === 'string' && error.length === 0;
  } catch {
    return false;
  }
}
