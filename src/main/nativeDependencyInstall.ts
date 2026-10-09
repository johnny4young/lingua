/**
 * Desktop install runner for Go / Rust / Ruby deps.
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
 *   - Env filtered through the allowlist per language; the host env
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
  type NativeInstallResult,
  type NativeInstallStatus,
  type NativePackageLanguage,
} from '../shared/dependencies/nativeDependencies';
export type { NativeInstallResult } from '../shared/dependencies/nativeDependencies';
import { MAX_NATIVE_STDERR_BYTES } from '../shared/runnerLimits';
import {
  GO_TOOLCHAIN_KEYS,
  RUBY_TOOLCHAIN_KEYS,
  RUST_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';
import { resolveWindowsLaunch } from './runners/hostExecutable';
import { trackNativeRunProcess } from './runners/nativeRunLifecycle';
import { createUtf8ChunkDecoder } from './runners/utf8Chunks';
import { truncateNativeOutputUtf8 } from './runners/nativeOutputUtf8';

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // installs pull from the network
const KILL_ESCALATION_DELAY_MS = 200;

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
  /** Test seam — production always uses `process.platform`. */
  platform?: NodeJS.Platform;
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
  if (!options.skipManifestCheck && !existsSync(path.join(options.cwd, manifest))) {
    return result('missing-manifest', {
      error: `No ${manifest} found in the project directory. Save the file inside a ${options.language} project first.`,
    });
  }

  const env = buildNativeRunnerEnv(
    combinedAllowlist(TOOLCHAIN_KEYS_BY_LANGUAGE[options.language]),
    options.userEnv
  );
  const spawnFn = options.spawnImpl ?? spawn;
  // Windows searches the project cwd before PATH for a bare name.
  const launch =
    (options.platform ?? process.platform) === 'win32'
      ? await resolveWindowsLaunch(command.binary, command.args, env)
      : { command: command.binary, args: [...command.args] };
  if (launch === null) {
    return result('missing-binary', { error: `${command.binary} was not found on PATH.` });
  }

  return await new Promise<NativeInstallResult>(resolve => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolved = false;
    let timedOut = false;
    let exited = false;
    let childExitCode: number | null = null;
    let escalationTimer: NodeJS.Timeout | null = null;
    let exitGraceTimer: NodeJS.Timeout | null = null;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(launch.command, launch.args, {
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

    // Quit disposal must reach installs too: the detached group outlives Lingua.
    const releaseChild = trackNativeRunProcess(child);
    const killTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      escalationTimer = setTimeout(
        () => killProcessTree(child, 'SIGKILL'),
        KILL_ESCALATION_DELAY_MS
      );
      if (exited) scheduleFinishAfterExit();
    }, INSTALL_TIMEOUT_MS);

    const finish = (value: NativeInstallResult) => {
      if (resolved) return;
      resolved = true;
      // The installer parent can close while TERM-ignoring descendants remain.
      // Finish cancellation before releasing the tracked tree or its deadline.
      if (timedOut) killProcessTree(child, 'SIGKILL');
      releaseChild();
      clearTimeout(killTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      if (exitGraceTimer !== null) clearTimeout(exitGraceTimer);
      resolve(value);
    };

    // A descendant outside the process group may retain the pipes. Once the
    // direct child has exited, bound collection without waiting for that child.
    function scheduleFinishAfterExit(): void {
      if (resolved || exitGraceTimer !== null) return;
      exitGraceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(
          result('timeout', {
            stdout,
            stderr,
            exitCode: childExitCode ?? -1,
            error: 'Install timed out.',
          })
        );
      }, KILL_ESCALATION_DELAY_MS);
    }

    const decodeStdout = createUtf8ChunkDecoder();
    const decodeStderr = createUtf8ChunkDecoder();
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const text = decodeStdout(chunk);
      stdout += text;
      // Streaming Buffer decoding keeps code points whole, so byte counts
      // compose without re-encoding all previously captured text.
      stdoutBytes += Buffer.byteLength(text, 'utf8');
      if (stdoutBytes > MAX_NATIVE_STDERR_BYTES) {
        stdout = truncateNativeOutputUtf8(stdout, MAX_NATIVE_STDERR_BYTES, '\n[stdout truncated]');
        stdoutTruncated = true;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      const text = decodeStderr(chunk);
      stderr += text;
      stderrBytes += Buffer.byteLength(text, 'utf8');
      if (stderrBytes > MAX_NATIVE_STDERR_BYTES) {
        stderr = truncateNativeOutputUtf8(stderr, MAX_NATIVE_STDERR_BYTES, '\n[stderr truncated]');
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

    child.on('exit', (code: number | null) => {
      exited = true;
      childExitCode = code;
      if (timedOut) scheduleFinishAfterExit();
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
          ...(exitCode === 0 ? {} : { error: stderr || `Install exited with code ${exitCode}` }),
        })
      );
    });
  });
}
