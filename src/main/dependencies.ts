/**
 * RL-025 Slice A + Slice B - main-side JS / TS dependency resolver
 * and installer.
 *
 * Slice A — read-only existence check against the active tab's
 * resolved cwd (`resolveNodeCwd` re-uses the Node-runner walker).
 *
 * Slice B — install path via `child_process.spawn('npm', …,
 * { shell: false })`. Reuses every safety primitive already in this
 * module (`isSafeSpecifier`, `resolveNodeCwd`) plus the runner-env
 * allowlist (`buildNativeRunnerEnv` / `NODE_TOOLCHAIN_KEYS`) and the
 * subprocess output cap (`MAX_NATIVE_STDERR_BYTES` / `truncateBytes`).
 *
 * Specifier safety: the caller's renderer already validated
 * specifiers via the shared detector (no `.`, no `..`, no `/`
 * absolute paths, no `node:` built-ins). Main re-validates so a
 * compromised renderer cannot probe arbitrary filesystem paths.
 *
 * Install policy (fold A): we refuse to spawn when the resolved cwd
 * has no `package.json`. Without this guard `npm install <name>`
 * silently creates a `package.json` next to a one-off scratchpad,
 * which violates the "no silent installs" line in
 * the internal dependency-manager ADR.
 *
 * Fold C — pre-flight integrity check: before spawning we re-run
 * the Slice A resolver against the batch and drop any specifier
 * that already maps to `installed`. Common case ("install" clicked
 * twice in a row) avoids a no-op `npm install`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MAX_NATIVE_STDERR_BYTES } from '../shared/runnerLimits';
import type {
  DependencyInstallFailureReason,
  DependencyInstallOutcome,
} from '../shared/dependencies/types';
import { NODE_TOOLCHAIN_KEYS, buildNativeRunnerEnv } from './runners/nativeEnv';
import { resolveNodeCwd } from './node-runner';

// This is intentionally npm-name strict, not package-manager generic:
// the installed dependency belongs to the user's JS/TS project and the
// child process below always invokes the user's `npm` binary. Repo
// maintenance commands still use pnpm; do not rewrite this path to
// `pnpm add` unless the product decision changes.
//
// Keep `-` last in each character class so it is treated as a literal
// hyphen. Shape: lowercase / digits / dot / underscore / hyphen, with
// an optional `@scope/` prefix.
const SAFE_PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/iu;

export type DependencyResolveStatus = 'installed' | 'detected' | 'invalid';

export interface DependencyResolveResult {
  readonly statuses: Record<string, DependencyResolveStatus>;
  readonly cwd: string | null;
  /**
   * RL-025 Slice B — whether the resolved cwd contains a
   * `package.json`. The renderer disables the Install button when
   * this is false (fold A: refuse silent project creation in a
   * scratchpad directory). `null` when no cwd was discoverable.
   */
  readonly hasPackageJson: boolean | null;
}

function isSafeSpecifier(specifier: unknown): specifier is string {
  if (typeof specifier !== 'string') return false;
  if (specifier.length === 0 || specifier.length > 214) return false;
  return SAFE_PACKAGE_NAME_RE.test(specifier);
}

function packageDirectoryFor(cwd: string, name: string): string {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/', 2);
    if (!scope || !pkg) return path.join(cwd, 'node_modules', name);
    return path.join(cwd, 'node_modules', scope, pkg);
  }
  return path.join(cwd, 'node_modules', name);
}

/**
 * Resolve a batch of npm package names against the cwd derived from
 * the active tab's `filePath`. Returns one status per requested
 * specifier in a flat record - the renderer maps the status to its
 * own `DependencyStatus` enum.
 *
 * When the caller does not pass a `filePath` (unsaved Scratchpad
 * tabs), `resolveNodeCwd` falls back to `app.getPath('temp')`.
 * Probing `<temp>/node_modules` could produce false installed rows
 * on shared CI hosts or developer machines, so unsaved tabs return
 * `detected` for every name instead.
 */
export function resolveJsDependencyBatch(
  specifiers: readonly unknown[],
  filePath?: string
): DependencyResolveResult {
  const hasFilePath = typeof filePath === 'string' && filePath.length > 0;
  const cwd = resolveNodeCwd(hasFilePath ? filePath : undefined);
  const statuses: Record<string, DependencyResolveStatus> = {};
  for (const raw of specifiers) {
    if (!isSafeSpecifier(raw)) continue;
    const name = raw;
    if (Object.prototype.hasOwnProperty.call(statuses, name)) continue;
    if (!hasFilePath) {
      statuses[name] = 'detected';
      continue;
    }
    try {
      const probe = packageDirectoryFor(cwd, name);
      // Stay inside `cwd/node_modules/...` - if the joined path
      // somehow escaped (e.g. a name with an embedded separator that
      // slipped the regex), refuse the probe.
      const nodeModulesRoot = path.join(cwd, 'node_modules');
      const relative = path.relative(nodeModulesRoot, probe);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        statuses[name] = 'invalid';
        continue;
      }
      statuses[name] = existsSync(probe) ? 'installed' : 'detected';
    } catch {
      statuses[name] = 'detected';
    }
  }
  return {
    statuses,
    cwd: hasFilePath ? cwd : null,
    hasPackageJson: hasFilePath ? packageJsonExistsIn(cwd) : null,
  };
}

// ────────────────────────────────────────────────────────────────
// RL-025 Slice B — JS / TS desktop install path.
// ────────────────────────────────────────────────────────────────

export type DependencyInstallResultStatus =
  | 'installed'
  | 'failed'
  | 'cancelled'
  | 'skipped-preflight';

export interface DependencyInstallResult {
  /** One outcome per requested specifier. */
  readonly statuses: Record<string, DependencyInstallResultStatus>;
  /** Whole-batch outcome (telemetry uses this). */
  readonly outcome: DependencyInstallOutcome;
  /**
   * Dominant failure reason when `outcome` is `partial` or `failed`.
   * `null` when the batch ended `success` or `cancelled` (the cancel
   * outcome carries its own reason via the `'cancelled'` enum below).
   */
  readonly failureReason: DependencyInstallFailureReason | null;
  /**
   * Absolute path of the cwd the install ran in. `null` when we
   * refused to spawn (unsaved tab, missing `package.json`, every
   * specifier invalid).
   */
  readonly cwd: string | null;
  /** Final `npm install` exit code. -1 when we never spawned. */
  readonly exitCode: number;
}

/** Per-line callback for streaming subprocess output to the renderer. */
export type DependencyInstallLogStream = 'stdout' | 'stderr';
export type DependencyInstallLogHandler = (
  stream: DependencyInstallLogStream,
  chunk: string
) => void;

export interface DependencyInstallBatchOptions {
  readonly runId: string;
  readonly filePath: string;
  readonly specifiers: readonly string[];
  readonly onLog?: DependencyInstallLogHandler;
}

/**
 * Total per-install timeout. Generous because a single `npm install
 * react` against a cold cache can routinely take 60–90 s on slow
 * networks. Cancellation is the user's lever; the timeout exists so
 * a hung registry connection eventually frees the run-id.
 */
const NPM_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

/** SIGTERM → SIGKILL escalation window (mirrors `node-runner.ts`). */
const KILL_ESCALATION_DELAY_MS = 200;

/**
 * Active install registry keyed by `runId`. A subsequent
 * `cancelJsDependencyInstall(runId)` reaches in to send SIGTERM
 * (then SIGKILL) and resolve the pending run as `'cancelled'`.
 */
interface ActiveInstall {
  readonly kill: (signal: NodeJS.Signals) => void;
  readonly markCancelled: () => void;
}
const activeInstalls = new Map<string, ActiveInstall>();

function packageJsonExistsIn(cwd: string): boolean {
  try {
    return existsSync(path.join(cwd, 'package.json'));
  } catch {
    return false;
  }
}

interface AppendCappedResult {
  readonly next: string;
  readonly truncated: boolean;
}
function appendCapped(
  buffer: string,
  chunk: string,
  max: number
): AppendCappedResult {
  if (buffer.length >= max) return { next: buffer, truncated: false };
  const room = max - buffer.length;
  if (chunk.length <= room) {
    return { next: `${buffer}${chunk}`, truncated: false };
  }
  return { next: `${buffer}${chunk.slice(0, room)}`, truncated: true };
}

export interface DependencyInstallBatchInternalOptions
  extends DependencyInstallBatchOptions {
  /**
   * Test seam — defaults to the production `spawn` from
   * `node:child_process`. Unit tests inject a stub that returns a
   * scripted EventEmitter so the batch can be exercised without
   * shelling out.
   */
  readonly spawnImpl?: typeof spawn;
}

/**
 * Spawn `npm install` for a batch of npm-name-safe specifiers and
 * resolve with a per-name status record. Never throws; every error
 * path returns a `DependencyInstallResult` so the IPC handler can
 * pass it straight to the renderer.
 *
 * Invariants:
 *   - `shell: false`, argv-only (no command-line interpolation).
 *   - Env via `buildNativeRunnerEnv([...NODE_TOOLCHAIN_KEYS], …)`.
 *   - cwd via `resolveNodeCwd(filePath)` (saved tab only).
 *   - Refuse without spawning when the cwd has no `package.json`
 *     (fold A: avoid silently turning a scratchpad into a project).
 *   - Pre-flight: re-run the Slice A resolver and skip already-
 *     installed names without spawning (fold C).
 *   - No `-g` / `--global` / `--prefix` flags ever — project
 *     isolation is part of the contract.
 */
export async function installJsDependencyBatch(
  options: DependencyInstallBatchInternalOptions
): Promise<DependencyInstallResult> {
  const { runId, filePath, specifiers, onLog } = options;
  const spawnFn = options.spawnImpl ?? spawn;

  const seen = new Set<string>();
  const statuses: Record<string, DependencyInstallResultStatus> = {};
  const safeNames: string[] = [];
  for (const raw of specifiers) {
    if (!isSafeSpecifier(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    safeNames.push(raw);
  }
  if (safeNames.length === 0) {
    return {
      statuses: {},
      outcome: 'failed',
      failureReason: 'invalid-specifier',
      cwd: null,
      exitCode: -1,
    };
  }

  if (typeof filePath !== 'string' || filePath.length === 0) {
    for (const name of safeNames) statuses[name] = 'failed';
    return {
      statuses,
      outcome: 'failed',
      failureReason: 'no-package-json',
      cwd: null,
      exitCode: -1,
    };
  }

  const cwd = resolveNodeCwd(filePath);
  if (!packageJsonExistsIn(cwd)) {
    for (const name of safeNames) statuses[name] = 'failed';
    return {
      statuses,
      outcome: 'failed',
      failureReason: 'no-package-json',
      cwd,
      exitCode: -1,
    };
  }

  // Fold C — pre-flight integrity check. Skip names that already
  // resolve as `installed`; we never invoke npm for a no-op.
  const preflight = resolveJsDependencyBatch(safeNames, filePath);
  const toInstall: string[] = [];
  for (const name of safeNames) {
    if (preflight.statuses[name] === 'installed') {
      statuses[name] = 'skipped-preflight';
    } else {
      toInstall.push(name);
    }
  }
  if (toInstall.length === 0) {
    return {
      statuses,
      outcome: 'success',
      failureReason: null,
      cwd,
      exitCode: 0,
    };
  }

  const env = buildNativeRunnerEnv([...NODE_TOOLCHAIN_KEYS], undefined);

  // Product install command, not repository setup. `npm install --save`
  // matches the copy shown in the dependency panel and the broadest
  // JavaScript project default; argv is fixed here so no renderer value
  // can add flags such as `--global`, `--prefix`, or lifecycle bypasses.
  const argv = [
    'install',
    ...toInstall,
    '--no-audit',
    '--no-fund',
    '--no-progress',
    '--save',
  ];

  if (activeInstalls.has(runId)) {
    for (const name of toInstall) statuses[name] = 'failed';
    return {
      statuses,
      outcome: 'failed',
      failureReason: 'unknown',
      cwd,
      exitCode: -1,
    };
  }

  let stdoutAcc = '';
  let stderrAcc = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;
  const truncationMarker = '\n[output truncated]';
  let child: ReturnType<typeof spawn>;
  try {
    child = spawnFn('npm', argv, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    for (const name of toInstall) statuses[name] = 'failed';
    return {
      statuses,
      outcome: 'failed',
      failureReason: 'binary-missing',
      cwd,
      exitCode: -1,
    };
  }

  return await new Promise<DependencyInstallResult>((resolve) => {
    let settled = false;
    let cancelled = false;
    let killTimer: NodeJS.Timeout | null = null;
    const clearKillTimer = (): void => {
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };
    const overallTimer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, KILL_ESCALATION_DELAY_MS);
      finalize('timed-out', 'timeout', -1, { keepKillTimer: true });
    }, NPM_INSTALL_TIMEOUT_MS);

    function finalize(
      outcome: DependencyInstallOutcome,
      failureReason: DependencyInstallFailureReason | null,
      exitCode: number,
      timerOptions: { readonly keepKillTimer?: boolean } = {}
    ): void {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (!timerOptions.keepKillTimer) clearKillTimer();
      activeInstalls.delete(runId);
      // Each requested name flips to its final state. Anything in
      // `toInstall` that survived without a successful exit code
      // is `failed`; on success they are all `installed`. The
      // skipped-preflight entries we set earlier survive.
      if (outcome === 'success') {
        for (const name of toInstall) statuses[name] = 'installed';
      } else if (outcome === 'cancelled') {
        for (const name of toInstall) {
          if (!statuses[name]) statuses[name] = 'cancelled';
        }
      } else {
        for (const name of toInstall) {
          if (!statuses[name]) statuses[name] = 'failed';
        }
      }
      resolve({
        statuses,
        outcome,
        failureReason,
        cwd,
        exitCode,
      });
    }

    activeInstalls.set(runId, {
      kill: (signal) => {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      },
      markCancelled: () => {
        cancelled = true;
      },
    });

    child.stdout?.on('data', (data: Buffer) => {
      if (stdoutTruncated) return;
      const text = data.toString('utf-8');
      const cap = MAX_NATIVE_STDERR_BYTES - truncationMarker.length;
      const prevLen = stdoutAcc.length;
      const result = appendCapped(stdoutAcc, text, cap);
      stdoutAcc = result.next;
      if (result.truncated) {
        stdoutTruncated = true;
        stdoutAcc = `${stdoutAcc}${truncationMarker}`;
        const room = Math.max(0, cap - prevLen);
        const fitted = text.slice(0, room);
        if (fitted.length > 0) onLog?.('stdout', fitted);
        onLog?.('stdout', truncationMarker);
        return;
      }
      onLog?.('stdout', text);
    });
    child.stderr?.on('data', (data: Buffer) => {
      if (stderrTruncated) return;
      const text = data.toString('utf-8');
      const cap = MAX_NATIVE_STDERR_BYTES - truncationMarker.length;
      const prevLen = stderrAcc.length;
      const result = appendCapped(stderrAcc, text, cap);
      stderrAcc = result.next;
      if (result.truncated) {
        stderrTruncated = true;
        stderrAcc = `${stderrAcc}${truncationMarker}`;
        const room = Math.max(0, cap - prevLen);
        const fitted = text.slice(0, room);
        if (fitted.length > 0) onLog?.('stderr', fitted);
        onLog?.('stderr', truncationMarker);
        return;
      }
      onLog?.('stderr', text);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        finalize('failed', 'binary-missing', -1);
        return;
      }
      finalize('failed', 'unknown', -1);
    });

    child.on('close', (code, signal) => {
      clearKillTimer();
      if (cancelled) {
        finalize('cancelled', 'cancelled', code ?? -1);
        return;
      }
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        if (!settled) finalize('cancelled', 'cancelled', code ?? -1);
        return;
      }
      const exitCode = typeof code === 'number' ? code : -1;
      if (exitCode === 0) {
        finalize('success', null, exitCode);
      } else {
        finalize('failed', 'exit-nonzero', exitCode);
      }
      // Reference the accumulated logs so eslint does not warn about
      // unused captures — they exist as a safety net for future
      // ipc-level diagnostics even though Slice B streams via onLog.
      void stdoutAcc;
      void stderrAcc;
    });
  });
}

/**
 * Cancel an in-flight install batch by `runId`. SIGTERM first,
 * SIGKILL after `KILL_ESCALATION_DELAY_MS`. Returns `true` when a
 * matching run was found.
 */
export function cancelJsDependencyInstall(runId: string): boolean {
  const active = activeInstalls.get(runId);
  if (!active) return false;
  active.markCancelled();
  active.kill('SIGTERM');
  setTimeout(() => {
    // If the install was still running when SIGTERM arrived, escalate.
    const still = activeInstalls.get(runId);
    if (still) still.kill('SIGKILL');
  }, KILL_ESCALATION_DELAY_MS);
  return true;
}

/** Test seam — exported only so unit tests can assert isolation. */
export function __resetActiveInstallsForTests(): void {
  activeInstalls.clear();
}
