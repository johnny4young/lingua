// SPDX-License-Identifier: MIT
/**
 * `lingua repro pack|review|run`: permissioned reproductions.
 *
 * pack and review never execute code. run checks the approval, probes for a
 * containment backend and refuses before launch unless every required control
 * is enforced. See docs/PERMISSIONED_REPRO_ADR.md.
 */

import { release } from 'node:os';
import path from 'node:path';

import { normalizeCapsuleWorkspacePath } from '../../shared/capsuleWorkspace';
import {
  approveReproEnvelope,
  buildReproEnvelope,
  computeReproApprovalToken,
  parseReproEnvelope,
  type ReproEnvelopeV1,
} from '../../shared/reproEnvelope';
import {
  DEFAULT_REPRO_REQUEST,
  requiredReproControls,
  resolveReproEffectivePolicy,
  type ReproBackendProbe,
  type ReproControl,
  type ReproPolicyV1,
} from '../../shared/reproPolicy';
import { summarizeReproReceipt, type ReproRefusedReceiptV1 } from '../../shared/reproReceipt';
import type { CliColorMode } from '../commandModel';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { emitCliFailure, renderCliNotice } from '../presentation';
import { probeContainment, type ReproContainmentBackend } from '../runtime/containment';
import { loadCapsule } from './capsule';

/** The recipient's ceiling until it becomes configurable; approval can only narrow to it. */
const LOCAL_CEILING: ReproPolicyV1 = DEFAULT_REPRO_REQUEST;

interface OutputArgs {
  json: boolean;
  quiet: boolean;
  color?: CliColorMode;
}

export interface ReproPackArgs extends OutputArgs {
  capsulePath: string;
  entry: string;
  files: ReadonlyArray<string>;
  root?: string;
  nodeMajor?: number;
}

export interface ReproReviewArgs extends OutputArgs {
  envelopePath: string;
  backends?: readonly ReproContainmentBackend[];
}

export interface ReproRunArgs extends ReproReviewArgs {
  approve: string;
  linguaVersion: string;
  now?: () => Date;
}

function languageForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (['.mjs', '.cjs', '.js'].includes(extension)) return 'javascript';
  if (extension === '.json') return 'json';
  return 'plaintext';
}

function readErrorReason(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === 'ENOENT' ? 'file-not-found' : 'read-failed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runReproPackCommand(args: ReproPackArgs, io: CliIo): Promise<CliExitCode> {
  const label = 'lingua repro pack';
  const capsule = await loadCapsule(args.capsulePath, io);
  if (!capsule.ok) {
    emitCliFailure(io, args, {
      label,
      reason: capsule.reason,
      detail: capsule.detail ?? `Could not read a Run Capsule from ${args.capsulePath}.`,
    });
    return CLI_EXIT_CODES.userInputError;
  }

  const root = path.resolve(args.root ?? '.');
  const files = [];
  for (const file of args.files) {
    if (normalizeCapsuleWorkspacePath(file) !== file) {
      emitCliFailure(io, args, {
        label,
        reason: 'invalid-path',
        detail: `${file} must be a relative path inside the root, with / separators.`,
      });
      return CLI_EXIT_CODES.userInputError;
    }
    try {
      const content = await io.readFile(path.join(root, ...file.split('/')));
      files.push({ path: file, language: languageForPath(file), content });
    } catch (error) {
      emitCliFailure(io, args, {
        label,
        reason: readErrorReason(error),
        detail: errorMessage(error),
      });
      return CLI_EXIT_CODES.userInputError;
    }
  }

  const built = await buildReproEnvelope({
    capsule: capsule.value,
    entry: args.entry,
    runtime: { name: 'node', major: args.nodeMajor ?? Number(process.versions.node.split('.')[0]) },
    files,
    request: DEFAULT_REPRO_REQUEST,
  });
  if (!built.ok) {
    emitCliFailure(io, args, {
      label,
      reason: built.reason,
      detail: built.detail ?? 'The reproduction envelope was rejected.',
    });
    return built.reason === 'unsupported-language' || built.reason === 'unsupported-runtime'
      ? CLI_EXIT_CODES.unsupportedCapability
      : CLI_EXIT_CODES.userInputError;
  }

  io.writeStdout(`${built.json}\n`);
  const secrets = built.value.privacy.obviousSecretsDetected;
  if (secrets > 0 && !args.quiet) {
    io.writeStderr(
      `${renderCliNotice(io, args.color, `${label}: ${secrets} possible secret(s) in the packed files; review before sharing.`)}\n`
    );
  }
  return CLI_EXIT_CODES.ok;
}

interface PreparedReview {
  envelope: ReproEnvelopeV1;
  approved: ReproPolicyV1;
  contentDigest: string;
  policyDigest: string;
  token: string;
  probe: ReproBackendProbe | null;
  /** Required controls the probed backend cannot enforce; every required one when there is no backend. */
  missing: readonly ReproControl[];
}

type PrepareResult =
  { ok: true; value: PreparedReview } | { ok: false; reason: string; detail: string };

async function prepareReview(
  envelopePath: string,
  io: CliIo,
  backends?: readonly ReproContainmentBackend[]
): Promise<PrepareResult> {
  let raw: string;
  try {
    raw = await io.readFile(envelopePath);
  } catch (error) {
    return { ok: false, reason: readErrorReason(error), detail: errorMessage(error) };
  }
  const parsed = parseReproEnvelope(raw);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, detail: parsed.detail ?? 'Invalid envelope.' };
  }
  const approval = await approveReproEnvelope(parsed.value, LOCAL_CEILING);
  if (!approval.ok) {
    return {
      ok: false,
      reason: 'hash-mismatch',
      detail: `${approval.path} does not match its recorded hash.`,
    };
  }
  const probe = await probeContainment(backends);
  const resolved = probe ? resolveReproEffectivePolicy(approval.policy, probe) : null;
  return {
    ok: true,
    value: {
      envelope: parsed.value,
      approved: approval.policy,
      contentDigest: approval.approval.contentDigest,
      policyDigest: approval.approval.policyDigest,
      token: await computeReproApprovalToken(approval.approval),
      probe,
      missing: resolved
        ? resolved.ok
          ? []
          : resolved.missing
        : requiredReproControls(approval.policy),
    },
  };
}

function hostLabel(): string {
  return `${process.platform} ${process.arch}`;
}

function describeWrites(policy: ReproPolicyV1): string {
  const areas = (['scratch', 'output'] as const).filter(
    area => policy.filesystem[area] === 'read-write'
  );
  return areas.length > 0 ? areas.join(', ') : 'none';
}

function describeLimits(policy: ReproPolicyV1): string {
  const { wallClockMs, outputBytes, processes, memoryBytes, diskBytes } = policy.limits;
  return [
    `wall ${wallClockMs} ms`,
    `output ${outputBytes} B`,
    `processes ${processes}`,
    `memory ${memoryBytes === null ? 'unbounded' : `${memoryBytes} B`}`,
    `disk ${diskBytes === null ? 'unbounded' : `${diskBytes} B`}`,
  ].join(' · ');
}

function describeBackend(review: PreparedReview): string {
  if (!review.probe) return `none on ${hostLabel()}; run refuses before launch`;
  const { id, version } = review.probe.backend;
  return review.missing.length > 0
    ? `${id} ${version} cannot enforce ${review.missing.join(', ')}; run refuses before launch`
    : `${id} ${version}`;
}

export async function runReproReviewCommand(
  args: ReproReviewArgs,
  io: CliIo
): Promise<CliExitCode> {
  const label = 'lingua repro review';
  const prepared = await prepareReview(args.envelopePath, io, args.backends);
  if (!prepared.ok) {
    emitCliFailure(io, args, { label, reason: prepared.reason, detail: prepared.detail });
    return CLI_EXIT_CODES.userInputError;
  }
  const review = prepared.value;
  const { envelope } = review;

  if (args.json) {
    io.writeStdout(
      `${JSON.stringify({
        ok: true,
        entry: envelope.entry,
        runtime: envelope.runtime,
        files: envelope.files.map(({ path: filePath, contentHash }) => ({
          path: filePath,
          contentHash,
        })),
        obviousSecretsDetected: envelope.privacy.obviousSecretsDetected,
        request: envelope.request,
        approvedPolicy: review.approved,
        requiredControls: requiredReproControls(review.approved),
        backend: review.probe?.backend ?? null,
        missingControls: review.missing,
        approval: {
          contentDigest: review.contentDigest,
          policyDigest: review.policyDigest,
          token: review.token,
        },
      })}\n`
    );
    return CLI_EXIT_CODES.ok;
  }
  if (args.quiet) return CLI_EXIT_CODES.ok;

  const rows: Array<[string, string]> = [
    ['entry', `${envelope.entry} · node ${envelope.runtime.major}`],
    ...envelope.files.map((file): [string, string] => [
      'file',
      `${file.path} ${file.contentHash.slice(0, 12)}`,
    ]),
    ['secrets', String(envelope.privacy.obviousSecretsDetected)],
    ['network', review.approved.network],
    ['writes', describeWrites(review.approved)],
    ['limits', describeLimits(review.approved)],
    ['evidence', `denials ${review.approved.evidence.denials}`],
    ['backend', describeBackend(review)],
    ['approve', `lingua repro run ${args.envelopePath} --approve ${review.token}`],
  ];
  io.writeStdout(rows.map(([key, value]) => `${key.padEnd(9)}${value}`).join('\n') + '\n');
  return CLI_EXIT_CODES.ok;
}

function refusedReceipt(
  review: PreparedReview,
  refusalReason: ReproRefusedReceiptV1['refusalReason'],
  args: ReproRunArgs
): ReproRefusedReceiptV1 {
  return {
    kind: 'lingua-repro-receipt',
    version: 1,
    createdAt: (args.now?.() ?? new Date()).toISOString(),
    contentDigest: review.contentDigest,
    approvedPolicyDigest: review.policyDigest,
    host: {
      lingua: args.linguaVersion,
      os: `${process.platform} ${release()}`,
      arch: process.arch,
      runtime: null,
      backend: review.probe?.backend ?? null,
    },
    launch: 'refused',
    refusalReason,
    missingControls: refusalReason === 'unenforceable' ? review.missing : [],
  };
}

export async function runReproRunCommand(args: ReproRunArgs, io: CliIo): Promise<CliExitCode> {
  const label = 'lingua repro run';
  const prepared = await prepareReview(args.envelopePath, io, args.backends);
  if (!prepared.ok) {
    emitCliFailure(io, args, { label, reason: prepared.reason, detail: prepared.detail });
    return CLI_EXIT_CODES.userInputError;
  }
  const review = prepared.value;

  let receipt: ReproRefusedReceiptV1;
  let detail: string;
  let exitCode: CliExitCode;
  if (args.approve !== review.token) {
    receipt = refusedReceipt(review, 'approval-invalid', args);
    detail = `The approval does not match this envelope and policy. Review it again with lingua repro review ${args.envelopePath}.`;
    exitCode = CLI_EXIT_CODES.userInputError;
  } else if (review.probe && review.missing.length > 0) {
    receipt = refusedReceipt(review, 'unenforceable', args);
    detail = `${review.probe.backend.id} cannot enforce ${review.missing.join(', ')}; nothing was run.`;
    exitCode = CLI_EXIT_CODES.unsupportedCapability;
  } else {
    // Launching arrives with the first backend; until then nothing here can run code.
    receipt = refusedReceipt(review, 'backend-unavailable', args);
    detail = review.probe
      ? `${review.probe.backend.id} cannot launch reproductions yet; nothing was run.`
      : `No containment backend is available on ${hostLabel()}; nothing was run.`;
    exitCode = CLI_EXIT_CODES.unsupportedCapability;
  }

  emitCliFailure(io, args, {
    label,
    reason: receipt.refusalReason,
    detail,
    extra: { receipt, verdict: summarizeReproReceipt(receipt, review.approved) },
  });
  return exitCode;
}
