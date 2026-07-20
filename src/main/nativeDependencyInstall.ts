/**
 * implementation (install lane) — desktop install runner for Go / Rust / Ruby deps.
 *
 * Pairs with the pure detection + planning in
 * `src/shared/dependencies/nativeDependencies.ts`: the renderer detects
 * specifiers, the user confirms, and this module spawns the toolchain
 * command that `buildInstallCommand` planned (`go get …`, `cargo add …`,
 * `bundle add …`).
 *
 * Security posture mirrors the language runners (node/ruby/rust):
 *   - `spawn()` only, never a shell; argv comes from `buildInstallCommand`,
 *     which already rejects specifiers with shell metacharacters.
 *   - Env filtered through the internal allowlist per language; the host env
 *     is not forwarded wholesale.
 *   - Runs in the project directory (the saved tab's dir) so the manifest
 *     (`go.mod` / `Cargo.toml` / `Gemfile`) is found; refuses without one.
 *   - Parent-owned timeout with SIGTERM→SIGKILL, stdout/stderr capped.
 *
 * The install itself needs the real toolchain + network, so end-to-end is
 * a desktop-smoke concern; the argv assembly, env filtering, cwd/manifest
 * refusal, and result mapping here are unit-tested with a mocked spawn.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  buildInstallCommand,
  type NativePackageLanguage,
} from '../shared/dependencies/nativeDependencies';
import { MAX_NATIVE_STDERR_BYTES, truncateBytes } from '../shared/runnerLimits';
import {
  GO_TOOLCHAIN_KEYS,
  RUBY_TOOLCHAIN_KEYS,
  RUST_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // installs pull from the network
const KILL_ESCALATION_DELAY_MS = 200;

export type NativeInstallStatus =
  | 'success'
  | 'error'
  | 'timeout'
  | 'missing-manifest'
  | 'invalid-specifiers'
  | 'missing-binary';

export interface NativeInstallResult {
  status: NativeInstallStatus;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

const MANIFEST_BY_LANGUAGE: Record<NativePackageLanguage, string> = {
  go: 'go.mod',
  rust: 'Cargo.toml',
  ruby: 'Gemfile',
};

const TOOLCHAIN_KEYS_BY_LANGUAGE: Record<NativePackageLanguage, readonly string[]> = {
  go: GO_TOOLCHAIN_KEYS,
  rust: RUST_TOOLCHAIN_KEYS,
  ruby: RUBY_TOOLCHAIN_KEYS,
};

export interface NativeInstallOptions {
  language: NativePackageLanguage;
  specifiers: readonly string[];
  /** Absolute path of the project directory holding the manifest. */
  cwd: string;
  userEnv?: Record<string, string>;
  /** Test seam. */
  spawnImpl?: typeof spawn;
  /** Test seam — skip the on-disk manifest existence check. */
  skipManifestCheck?: boolean;
}

function result(
  status: NativeInstallStatus,
  extra: Partial<NativeInstallResult> = {}
): NativeInstallResult {
  return {
    status,
    stdout: extra.stdout ?? '',
    stderr: extra.stderr ?? '',
    exitCode: extra.exitCode ?? -1,
    ...(extra.error !== undefined ? { error: extra.error } : {}),
  };
}

export async function installNativeDependencies(
  options: NativeInstallOptions
): Promise<NativeInstallResult> {
  const command = buildInstallCommand(options.language, options.specifiers);
  if (!command) {
    return result('invalid-specifiers', {
      error: 'No valid package specifiers to install.',
    });
  }

  const manifest = MANIFEST_BY_LANGUAGE[options.language];
  if (
    !options.skipManifestCheck &&
    !existsSync(path.join(options.cwd, manifest))
  ) {
    return result('missing-manifest', {
      error: `No ${manifest} found in the project directory. Save the file inside a ${options.language} project first.`,
    });
  }

  const env = buildNativeRunnerEnv(
    combinedAllowlist(TOOLCHAIN_KEYS_BY_LANGUAGE[options.language]),
    options.userEnv
  );
  const spawnFn = options.spawnImpl ?? spawn;

  return await new Promise<NativeInstallResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolved = false;
    let timedOut = false;
    let escalationTimer: NodeJS.Timeout | null = null;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(command.binary, command.args, {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...detachedSpawnOptions(),
      });
    } catch (err) {
      resolve(
        result('error', {
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return;
    }

    const killTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      escalationTimer = setTimeout(
        () => killProcessTree(child, 'SIGKILL'),
        KILL_ESCALATION_DELAY_MS
      );
    }, INSTALL_TIMEOUT_MS);

    const finish = (value: NativeInstallResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      resolve(value);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdout += chunk.toString();
      if (stdout.length > MAX_NATIVE_STDERR_BYTES) {
        stdout = truncateBytes(stdout, MAX_NATIVE_STDERR_BYTES, '\n[stdout truncated]');
        stdoutTruncated = true;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderr += chunk.toString();
      if (stderr.length > MAX_NATIVE_STDERR_BYTES) {
        stderr = truncateBytes(stderr, MAX_NATIVE_STDERR_BYTES, '\n[stderr truncated]');
        stderrTruncated = true;
      }
    });

    child.on('error', (err: Error) => {
      const message = err.message || `Failed to spawn ${command.binary}`;
      const missing = /ENOENT/.test(message) || /not found/i.test(message);
      finish(
        result(missing ? 'missing-binary' : 'error', {
          stdout,
          stderr: stderr || message,
          error: message,
        })
      );
    });

    child.on('close', (code: number | null) => {
      const exitCode = code ?? -1;
      if (timedOut) {
        finish(result('timeout', { stdout, stderr, exitCode, error: 'Install timed out.' }));
        return;
      }
      finish(
        result(exitCode === 0 ? 'success' : 'error', {
          stdout,
          stderr,
          exitCode,
          ...(exitCode === 0
            ? {}
            : { error: stderr || `Install exited with code ${exitCode}` }),
        })
      );
    });
  });
}
