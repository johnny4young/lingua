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

import { capsuleStrictVerificationRefusal } from '../../shared/capsuleVerification';
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
  computeReproEffectivePolicyDigest,
  requiredReproControls,
  resolveReproEffectivePolicy,
  type ReproControl,
  type ReproEffectivePolicy,
  type ReproPolicyV1,
} from '../../shared/reproPolicy';
import {
  summarizeReproReceipt,
  type ReproLaunchedReceiptV1,
  type ReproReceiptHostV1,
  type ReproRefusedReceiptV1,
  type ReproVerdict,
} from '../../shared/reproReceipt';
import type { CliColorMode } from '../commandModel';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { emitCliFailure, renderCliNotice } from '../presentation';
import {
  probeContainment,
  resolveReproNodeRuntime,
  type ProbedBackend,
  type ReproContainmentBackend,
  type ReproNodeRuntime,
} from '../runtime/containment';
import {
  ReproStagingError,
  disposeReproStaging,
  stageReproEnvelope,
} from '../runtime/reproStaging';
import { errorMessage, loadCapsule, readFailureReason } from './capsule';
import { strictCapsuleVerdict } from './capsuleVerify';

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
  resolveNode?: () => Promise<ReproNodeRuntime | null>;
}

export interface ReproRunArgs extends ReproReviewArgs {
  approve: string;
  linguaVersion: string;
  now?: () => Date;
  /** Where the private staging root is created; defaults to the OS temp directory. */
  stagingParent?: string;
}

function languageForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (['.mjs', '.cjs', '.js'].includes(extension)) return 'javascript';
  if (extension === '.json') return 'json';
  return 'plaintext';
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Leaves plain paths alone and single-quotes anything a shell would split or expand. */
function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

type PackedFile = { path: string; language: string; content: string };

/** Reads one --file, refusing anything that resolves outside the root or is not UTF-8 text. */
async function readPackedFile(
  io: CliIo,
  root: string,
  realRoot: string,
  file: string
): Promise<{ ok: true; value: PackedFile } | { ok: false; reason: string; detail: string }> {
  if (normalizeCapsuleWorkspacePath(file) !== file) {
    return {
      ok: false,
      reason: 'invalid-path',
      detail: `${file} must be a relative path inside the root, with / separators.`,
    };
  }
  const target = path.join(root, ...file.split('/'));
  let bytes: Uint8Array;
  try {
    const realTarget = await io.realPath(target);
    if (!realTarget.startsWith(`${realRoot}${path.sep}`)) {
      return {
        ok: false,
        reason: 'outside-root',
        detail: `${file} resolves outside the root through a symbolic link.`,
      };
    }
    bytes = await io.readFileBytes(target);
  } catch (error) {
    return { ok: false, reason: readFailureReason(error), detail: errorMessage(error) };
  }
  try {
    return {
      ok: true,
      value: { path: file, language: languageForPath(file), content: strictUtf8.decode(bytes) },
    };
  } catch {
    return { ok: false, reason: 'not-utf8', detail: `${file} is not UTF-8 text.` };
  }
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
  let realRoot: string;
  try {
    realRoot = await io.realPath(root);
  } catch (error) {
    emitCliFailure(io, args, {
      label,
      reason: readFailureReason(error),
      detail: errorMessage(error),
    });
    return CLI_EXIT_CODES.userInputError;
  }
  const files: PackedFile[] = [];
  for (const file of args.files) {
    const read = await readPackedFile(io, root, realRoot, file);
    if (!read.ok) {
      emitCliFailure(io, args, { label, reason: read.reason, detail: read.detail });
      return CLI_EXIT_CODES.userInputError;
    }
    files.push(read.value);
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
  backend: ProbedBackend | null;
  effective: ReproEffectivePolicy | null;
  /** Required controls the probed backend cannot enforce; every required one when there is no backend. */
  missing: readonly ReproControl[];
  node: ReproNodeRuntime | null;
}

type PrepareResult =
  { ok: true; value: PreparedReview } | { ok: false; reason: string; detail: string };

async function prepareReview(args: ReproReviewArgs, io: CliIo): Promise<PrepareResult> {
  let raw: string;
  try {
    raw = await io.readFile(args.envelopePath);
  } catch (error) {
    return { ok: false, reason: readFailureReason(error), detail: errorMessage(error) };
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
  const backend = await probeContainment(args.backends);
  const resolved = backend ? resolveReproEffectivePolicy(approval.policy, backend.probe) : null;
  return {
    ok: true,
    value: {
      envelope: parsed.value,
      approved: approval.policy,
      contentDigest: approval.approval.contentDigest,
      policyDigest: approval.approval.policyDigest,
      token: await computeReproApprovalToken(approval.approval),
      backend,
      effective: resolved?.ok ? resolved.value : null,
      missing: resolved
        ? resolved.ok
          ? []
          : resolved.missing
        : requiredReproControls(approval.policy),
      node: await (args.resolveNode ?? resolveReproNodeRuntime)(),
    },
  };
}

function hostLabel(): string {
  return `${process.platform} ${process.arch}`;
}

function nodeMajor(node: ReproNodeRuntime): number {
  return Number(node.version.split('.')[0]);
}

function runtimeMatches(review: PreparedReview): boolean {
  return review.node !== null && nodeMajor(review.node) === review.envelope.runtime.major;
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
  if (!review.backend) return `none on ${hostLabel()}; run refuses before launch`;
  const { id, version } = review.backend.probe.backend;
  return review.missing.length > 0
    ? `${id} ${version} cannot enforce ${review.missing.join(', ')}; run refuses before launch`
    : `${id} ${version}`;
}

function describeRuntime(review: PreparedReview): string {
  const wanted = `node ${review.envelope.runtime.major}`;
  if (!review.node) return `${wanted} requested; Node.js not found; run refuses before launch`;
  return runtimeMatches(review)
    ? `node ${review.node.version}`
    : `${wanted} requested; found ${review.node.version}; run refuses before launch`;
}

export async function runReproReviewCommand(
  args: ReproReviewArgs,
  io: CliIo
): Promise<CliExitCode> {
  const label = 'lingua repro review';
  const prepared = await prepareReview(args, io);
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
        hostRuntime: review.node?.version ?? null,
        files: envelope.files.map(({ path: filePath, contentHash }) => ({
          path: filePath,
          contentHash,
        })),
        obviousSecretsDetected: envelope.privacy.obviousSecretsDetected,
        request: envelope.request,
        approvedPolicy: review.approved,
        requiredControls: requiredReproControls(review.approved),
        backend: review.backend?.probe.backend ?? null,
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
    ['entry', envelope.entry],
    ...envelope.files.map((file): [string, string] => [
      'file',
      `${file.path} ${file.contentHash.slice(0, 12)}`,
    ]),
    ['secrets', String(envelope.privacy.obviousSecretsDetected)],
    ['runtime', describeRuntime(review)],
    ['network', review.approved.network],
    ['writes', describeWrites(review.approved)],
    ['limits', describeLimits(review.approved)],
    ['evidence', `denials ${review.approved.evidence.denials}`],
    ['backend', describeBackend(review)],
    ['approve', `lingua repro run ${shellQuote(args.envelopePath)} --approve ${review.token}`],
  ];
  io.writeStdout(rows.map(([key, value]) => `${key.padEnd(9)}${value}`).join('\n') + '\n');
  return CLI_EXIT_CODES.ok;
}

function receiptHost(
  review: PreparedReview,
  args: ReproRunArgs,
  launched: boolean
): ReproReceiptHostV1 {
  return {
    lingua: args.linguaVersion,
    os: `${process.platform} kernel ${release()}`,
    arch: process.arch,
    runtime: launched && review.node ? `node ${review.node.version}` : null,
    backend: review.backend?.probe.backend ?? null,
  };
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
    host: receiptHost(review, args, false),
    launch: 'refused',
    refusalReason,
    missingControls: refusalReason === 'unenforceable' ? review.missing : [],
  };
}

const VERDICT_EXIT_CODES: Record<Exclude<ReproVerdict['overall'], 'refused'>, CliExitCode> = {
  pass: CLI_EXIT_CODES.ok,
  fail: CLI_EXIT_CODES.verificationFailed,
  incomplete: CLI_EXIT_CODES.verificationInconclusive,
};

async function launchReproduction(
  review: PreparedReview,
  backend: ProbedBackend,
  effective: ReproEffectivePolicy,
  node: ReproNodeRuntime,
  args: ReproRunArgs,
  io: CliIo
): Promise<CliExitCode> {
  const label = 'lingua repro run';
  const { capsule } = review.envelope;
  let staging;
  try {
    staging = await stageReproEnvelope(review.envelope, args.stagingParent);
  } catch (error) {
    emitCliFailure(io, args, {
      label,
      reason: error instanceof ReproStagingError ? error.reason : 'staging-failed',
      detail: errorMessage(error),
    });
    return CLI_EXIT_CODES.runtimeError;
  }

  try {
    const outcome = await backend.backend.launch({
      staging,
      policy: review.approved,
      node,
      args: capsule.input.args ?? [],
      ...(capsule.input.stdin !== undefined ? { stdin: capsule.input.stdin } : {}),
    });
    const { result } = outcome;
    const receipt: ReproLaunchedReceiptV1 = {
      kind: 'lingua-repro-receipt',
      version: 1,
      createdAt: (args.now?.() ?? new Date()).toISOString(),
      contentDigest: review.contentDigest,
      approvedPolicyDigest: review.policyDigest,
      host: receiptHost(review, args, true),
      launch: 'launched',
      effectivePolicyDigest: await computeReproEffectivePolicyDigest(effective),
      controls: effective.controls,
      execution: {
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        startedAt: outcome.startedAt.toISOString(),
        endedAt: outcome.endedAt.toISOString(),
        outputTruncated: Boolean(result.truncated?.stdout || result.truncated?.stderr),
      },
      comparison: capsuleStrictVerificationRefusal(capsule)
        ? 'inconclusive'
        : strictCapsuleVerdict(capsule, result).verdict,
      evidence: outcome.evidence,
    };
    const verdict = summarizeReproReceipt(receipt, review.approved);
    if (verdict.overall === 'refused') return CLI_EXIT_CODES.internal;

    if (args.json) {
      io.writeStdout(
        `${JSON.stringify({
          ok: verdict.overall === 'pass',
          receipt,
          verdict,
          stdout: result.stdout,
          stderr: result.stderr,
        })}\n`
      );
    } else {
      // Workload output is untrusted text, shown exactly as the capped streams hold it.
      io.writeStdout(result.stdout);
      io.writeStderr(result.stderr);
      if (!args.quiet) {
        const summary = `${label}: ${verdict.overall} (output ${verdict.output}, enforcement ${verdict.enforcement}, compliance ${verdict.compliance}, evidence ${verdict.evidence})`;
        io.writeStderr(
          `${renderCliNotice(io, args.color, summary, verdict.overall === 'pass' ? 'success' : 'warning')}\n`
        );
      }
    }
    return VERDICT_EXIT_CODES[verdict.overall];
  } finally {
    await disposeReproStaging(staging);
  }
}

export async function runReproRunCommand(args: ReproRunArgs, io: CliIo): Promise<CliExitCode> {
  const label = 'lingua repro run';
  const prepared = await prepareReview(args, io);
  if (!prepared.ok) {
    emitCliFailure(io, args, { label, reason: prepared.reason, detail: prepared.detail });
    return CLI_EXIT_CODES.userInputError;
  }
  const review = prepared.value;
  const { backend, effective, node } = review;

  let receipt: ReproRefusedReceiptV1;
  let detail: string;
  let exitCode: CliExitCode = CLI_EXIT_CODES.unsupportedCapability;
  if (args.approve.trim().toLowerCase() !== review.token) {
    receipt = refusedReceipt(review, 'approval-invalid', args);
    detail = `The approval does not match this envelope and policy. Review it again with lingua repro review ${shellQuote(args.envelopePath)}.`;
    exitCode = CLI_EXIT_CODES.userInputError;
  } else if (!backend) {
    receipt = refusedReceipt(review, 'backend-unavailable', args);
    detail = `No containment backend is available on ${hostLabel()}; nothing was run.`;
  } else if (!effective) {
    receipt = refusedReceipt(review, 'unenforceable', args);
    detail = `${backend.probe.backend.id} cannot enforce ${review.missing.join(', ')}; nothing was run.`;
  } else if (!node || !runtimeMatches(review)) {
    receipt = refusedReceipt(review, 'runtime-unavailable', args);
    detail = `${describeRuntime(review).replace('; run refuses before launch', '')}; nothing was run.`;
  } else {
    return launchReproduction(review, backend, effective, node, args, io);
  }

  emitCliFailure(io, args, {
    label,
    reason: receipt.refusalReason,
    detail,
    extra: { receipt, verdict: summarizeReproReceipt(receipt, review.approved) },
  });
  return exitCode;
}
