/** Exact stream verification, not a security or hermetic-reproduction claim. */
import { MAX_STREAM_BYTES, type RunCapsuleV1 } from './runCapsule';
import { utf8ByteLength } from './utf8';

export type CapsuleVerdict = 'pass' | 'fail' | 'inconclusive';
export interface CapsuleComparison {
  matches: boolean;
  status: boolean;
  stdout: boolean;
  stderr: boolean;
}
export function capsuleVerificationBlocker(
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
export function compareCapsuleStreams(
  capsule: RunCapsuleV1,
  actual: { status: string; stdout: string; stderr: string }
): CapsuleComparison {
  const status = capsule.result.status === actual.status;
  const stdout = (capsule.result.stdout ?? '') === actual.stdout;
  const stderr = (capsule.result.stderr ?? '') === actual.stderr;
  return { matches: status && stdout && stderr, status, stdout, stderr };
}
