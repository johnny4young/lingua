// SPDX-License-Identifier: MIT
/**
 * Containment backends for permissioned reproductions.
 *
 * A backend reports what it can enforce on this host before anything runs,
 * and launches only inside a staging root the supervisor owns.
 */

import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type { ReproBackendProbe, ReproPolicyV1 } from '../../shared/reproPolicy';
import type { ReproEvidenceV1 } from '../../shared/reproReceipt';
import type { CliExecutionResult } from './execution';
import type { ReproStaging } from './reproStaging';
import { seatbeltBackend } from './seatbelt';
import { buildCliRuntimeEnvironment } from './environment';
import { findExecutableOnPath, nodeRuntimeExecutable } from './targets';

export interface ReproNodeRuntime {
  /** Canonical path; profiles allow exactly this binary. */
  readonly path: string;
  readonly version: string;
}

export interface ReproLaunchRequest {
  readonly staging: ReproStaging;
  readonly policy: ReproPolicyV1;
  readonly node: ReproNodeRuntime;
  readonly args: ReadonlyArray<string>;
  readonly stdin?: string;
}

export interface ReproLaunchOutcome {
  readonly result: CliExecutionResult;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly evidence: ReproEvidenceV1;
}

export interface ReproContainmentBackend {
  readonly id: string;
  /** Null when the backend cannot run on this host at all. */
  probe(): Promise<ReproBackendProbe | null>;
  launch(request: ReproLaunchRequest): Promise<ReproLaunchOutcome>;
}

export const CONTAINMENT_BACKENDS: readonly ReproContainmentBackend[] = [seatbeltBackend];

export interface ProbedBackend {
  readonly backend: ReproContainmentBackend;
  readonly probe: ReproBackendProbe;
}

/** First backend that answers its probe on this host, or null. A probe that throws counts as absent. */
export async function probeContainment(
  backends: readonly ReproContainmentBackend[] = CONTAINMENT_BACKENDS
): Promise<ProbedBackend | null> {
  for (const backend of backends) {
    try {
      const probe = await backend.probe();
      if (probe) return { backend, probe };
    } catch {
      // Fail closed: an unanswered probe is the same as no backend.
    }
  }
  return null;
}

/** The Node.js binary a reproduction would run with, resolved outside any sandbox. */
export async function resolveReproNodeRuntime(
  executable: string = nodeRuntimeExecutable(),
  env: NodeJS.ProcessEnv = process.env
): Promise<ReproNodeRuntime | null> {
  // A relative PATH entry would let a binary planted in the working directory become the runtime.
  const absolutePath = (env.PATH ?? '')
    .split(path.delimiter)
    .filter(entry => path.isAbsolute(entry))
    .join(path.delimiter);
  const found = path.isAbsolute(executable)
    ? executable
    : await findExecutableOnPath(executable, process.platform, { ...env, PATH: absolutePath });
  if (!found) return null;
  try {
    const resolved = await realpath(found);
    const version = await new Promise<string>((resolve, reject) => {
      execFile(
        resolved,
        ['-p', 'process.versions.node'],
        { timeout: 5_000, env: buildCliRuntimeEnvironment([]) },
        (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))
      );
    });
    return /^\d+\.\d+\.\d+$/u.test(version) ? { path: resolved, version } : null;
  } catch {
    return null;
  }
}
