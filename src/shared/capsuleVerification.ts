/** Exact stream verification, not a security or hermetic-reproduction claim. */
import { MAX_STREAM_BYTES, type RunCapsuleV1 } from './runCapsule';
import { MAX_NATIVE_STDERR_BYTES } from './runnerLimits';
import { utf8ByteLength } from './utf8';

export const CLI_OUTPUT_TRUNCATION_MARKER = '\n[output truncated by Lingua CLI]\n';
/** Largest stream the CLI captures unclipped. */
export const CLI_OUTPUT_PAYLOAD_BYTES =
  MAX_NATIVE_STDERR_BYTES - utf8ByteLength(CLI_OUTPUT_TRUNCATION_MARKER);

export type CapsuleVerdict = 'pass' | 'fail' | 'inconclusive';
export interface CapsuleComparison {
  matches: boolean;
  status: boolean;
  stdout: boolean;
  stderr: boolean;
}
function capsuleVerificationBlocker(
  capsule: RunCapsuleV1,
  maxStreamBytes = MAX_STREAM_BYTES
): string | null {
  if (capsule.result.status !== 'success') return 'unsupported-baseline-status';
  if (
    capsule.privacy.omittedFields.some(field =>
      /^(source|input)(\.|$)|^result\.(stdout|stderr|lineResults|richOutputs)(\.|$)/.test(field)
    )
  )
    return 'incomplete-baseline';
  if (capsule.result.lineResults?.length || capsule.result.richOutputs?.length)
    return 'unsupported-baseline-output';
  if (
    utf8ByteLength(capsule.result.stdout ?? '') > maxStreamBytes ||
    utf8ByteLength(capsule.result.stderr ?? '') > maxStreamBytes
  )
    return 'incomplete-baseline';
  return null;
}
/** Recordings whose app engine differs from the CLI's host interpreter or compiler. */
function capsuleEngineDivergence(capsule: RunCapsuleV1): string | null {
  const { language } = capsule.tab;
  const divergent =
    language === 'python' ||
    language === 'go' ||
    (language === 'ruby' && capsule.environment.platform === 'web');
  return divergent ? 'engine-divergent-baseline' : null;
}
export function compareCapsuleStreams(
  capsule: RunCapsuleV1,
  actual: { status: string; stdout: string; stderr: string }
): CapsuleComparison {
  const status = capsule.result.status === actual.status;
  const stdout = (capsule.result.stdout ?? '') === actual.stdout;
  const stderr = (capsule.result.stderr ?? '') === actual.stderr;
  return { matches: status && stdout && stderr, status, stdout, stderr };
}

/** Why the CLI can never pass this recording, checked before anything executes. */
export function capsuleStrictVerificationRefusal(capsule: RunCapsuleV1): string | null {
  return (
    capsuleVerificationBlocker(capsule, CLI_OUTPUT_PAYLOAD_BYTES) ??
    capsuleEngineDivergence(capsule) ??
    (capsule.tab.runtimeMode === 'browser-preview' ? 'unsupported-runtime-mode' : null)
  );
}
