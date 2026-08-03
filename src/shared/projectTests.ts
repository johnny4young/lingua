/**
 * Dependency-free contracts for desktop project test discovery and execution.
 *
 * Detection is advisory UX. The main process re-detects the requested runner
 * immediately before every spawn, and the project root is always resolved from
 * its filesystem capability instead of accepting an absolute renderer path.
 */

const PROJECT_TEST_FRAMEWORKS = ['vitest', 'jest', 'pytest', 'go', 'cargo'] as const;

export type ProjectTestFramework = (typeof PROJECT_TEST_FRAMEWORKS)[number];

type ProjectTestUnavailableReason = 'dependencies-not-installed' | 'toolchain-not-found';

export interface ProjectTestCandidate {
  framework: ProjectTestFramework;
  /** Human-readable, fixed argv preview. Never executed through a shell. */
  command: string;
  /** Root-level manifests/configuration that caused the match. */
  evidence: string[];
  available: boolean;
  unavailableReason?: ProjectTestUnavailableReason;
}

export interface ProjectTestDetectionResult {
  kind: 'ready' | 'none';
  candidates: ProjectTestCandidate[];
}

export type ProjectTestRunKind =
  | 'success'
  | 'failed'
  | 'timed-out'
  | 'stopped'
  | 'not-detected'
  | 'unavailable'
  | 'busy'
  | 'invalid-request';

export interface ProjectTestOutputEvent {
  runId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface ProjectTestRunResult {
  kind: ProjectTestRunKind;
  framework: ProjectTestFramework | null;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  timeoutMs: number;
  unavailableReason?: ProjectTestUnavailableReason;
}

export function isProjectTestFramework(value: unknown): value is ProjectTestFramework {
  return (
    typeof value === 'string' && (PROJECT_TEST_FRAMEWORKS as readonly string[]).includes(value)
  );
}
