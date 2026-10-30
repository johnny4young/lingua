// SPDX-License-Identifier: MIT
/**
 * Private, parent-owned staging for a permissioned reproduction.
 *
 * Inputs are written exclusively into a fresh 0700 directory, read back and
 * re-hashed, then made read-only, so the workload runs exactly the reviewed
 * bytes. Scratch and output are empty and discarded with the whole root.
 */

import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { computeContentHash } from '../../shared/contentHash';
import type { ReproEnvelopeV1 } from '../../shared/reproEnvelope';

export interface ReproStaging {
  /** Canonical path of the private root; every area below sits inside it. */
  readonly root: string;
  readonly inputs: string;
  readonly scratch: string;
  readonly output: string;
  readonly entry: string;
}

export class ReproStagingError extends Error {
  constructor(
    readonly reason: 'staging-failed' | 'staged-hash-mismatch',
    message: string
  ) {
    super(message);
    this.name = 'ReproStagingError';
  }
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function stagedPath(inputs: string, relative: string): string {
  return path.join(inputs, ...relative.split('/'));
}

/** Throws ReproStagingError; the caller owns cleanup through disposeReproStaging. */
export async function stageReproEnvelope(
  envelope: ReproEnvelopeV1,
  parent: string = tmpdir()
): Promise<ReproStaging> {
  const root = await realpath(await mkdtemp(path.join(parent, 'lingua-repro-')));
  const staging: ReproStaging = {
    root,
    inputs: path.join(root, 'inputs'),
    scratch: path.join(root, 'scratch'),
    output: path.join(root, 'output'),
    entry: stagedPath(path.join(root, 'inputs'), envelope.entry),
  };
  const files = [
    {
      path: envelope.entry,
      content: envelope.capsule.source.content,
      contentHash: envelope.capsule.source.contentHash,
    },
    ...envelope.files,
  ];
  try {
    for (const area of [staging.inputs, staging.scratch, staging.output]) {
      await mkdir(area, { mode: 0o700 });
    }
    for (const file of files) {
      const target = stagedPath(staging.inputs, file.path);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      // `wx` fails instead of following or replacing anything already there.
      await writeFile(target, file.content, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    throw new ReproStagingError(
      'staging-failed',
      error instanceof Error ? error.message : String(error)
    );
  }

  for (const file of files) {
    const target = stagedPath(staging.inputs, file.path);
    let staged: string;
    try {
      staged = strictUtf8.decode(await readFile(target));
    } catch {
      throw new ReproStagingError('staged-hash-mismatch', `${file.path} could not be read back.`);
    }
    if ((await computeContentHash(staged)) !== file.contentHash) {
      throw new ReproStagingError('staged-hash-mismatch', `${file.path} changed while staging.`);
    }
    await chmod(target, 0o444);
  }
  return staging;
}

export async function disposeReproStaging(staging: Pick<ReproStaging, 'root'>): Promise<void> {
  await rm(staging.root, { recursive: true, force: true });
}
