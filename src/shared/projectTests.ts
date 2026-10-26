/**
 * Dependency-free contracts for desktop project test discovery and execution.
 *
 * Detection is advisory UX. The main process re-detects the requested runner
 * immediately before every spawn, and the project root is always resolved from
 * its filesystem capability instead of accepting an absolute renderer path.
 */

const PROJECT_TEST_FRAMEWORKS = ['vitest', 'jest', 'pytest', 'go', 'cargo'] as const;

export type ProjectTestFramework = (typeof PROJECT_TEST_FRAMEWORKS)[number];

type ProjectTestUnavailableReason =
  'dependencies-not-installed' | 'toolchain-not-found' | 'node-not-found';

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

export type ProjectTestCaseStatus = 'passed' | 'failed' | 'skipped';

/**
 * One test as its runner reported it. `file` is project-relative with `/`;
 * Go reports a package directory, `.` for the module root.
 */
export interface ProjectTestCase {
  file: string;
  /** Suite names from the outermost to the test's own title. */
  path: string[];
  status: ProjectTestCaseStatus;
  durationMs?: number;
  /** Where the failing assertion is, project-relative, when the runner says. */
  failureFile?: string;
  failureLine?: number;
  failureMessage?: string;
  /** False for cases the runner cannot select on their own (Rust doc tests). */
  runnable?: boolean;
}

export type ProjectTestScope =
  | { kind: 'all' }
  | { kind: 'file'; file: string }
  | { kind: 'test'; file: string; path: string[] };

export const PROJECT_TEST_MAX_CASES = 5_000;

export interface ProjectTestRunResult {
  kind: ProjectTestRunKind;
  framework: ProjectTestFramework | null;
  command: string;
  /** Capture-observed interleaving; absent for legacy/unstreamed results. */
  orderedOutput?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  timeoutMs: number;
  unavailableReason?: ProjectTestUnavailableReason;
  scope?: ProjectTestScope;
  /** Absent when the runner's report could not be read; the raw output still is. */
  cases?: ProjectTestCase[];
  casesTruncated?: boolean;
}

export function isProjectTestFramework(value: unknown): value is ProjectTestFramework {
  return (
    typeof value === 'string' && (PROJECT_TEST_FRAMEWORKS as readonly string[]).includes(value)
  );
}

/** Transient execution correlation only; never a persisted identifier. */
export function isProjectTestRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value);
}

const SCOPE_TEXT_LIMIT = 512;

function isScopeText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SCOPE_TEXT_LIMIT &&
    ![...value].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
  );
}

/** A project-relative path that cannot climb out of the root or read as an option. */
export function isProjectTestRelativePath(value: unknown): value is string {
  if (!isScopeText(value)) return false;
  if (value === '.') return true;
  if (value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/u.test(value)) return false;
  // A leading `-` reads as an option and `@` as a pytest argument file.
  return value
    .split('/')
    .every(segment => segment !== '' && segment !== '.' && segment !== '..' && !/^[-@]/u.test(segment));
}

export function parseProjectTestScope(value: unknown): ProjectTestScope | null {
  if (value === undefined) return { kind: 'all' };
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'all') return { kind: 'all' };
  if (!isProjectTestRelativePath(record.file)) return null;
  if (record.kind === 'file') return { kind: 'file', file: record.file };
  if (
    record.kind === 'test' &&
    Array.isArray(record.path) &&
    record.path.length > 0 &&
    record.path.length <= 32 &&
    record.path.every(isScopeText)
  ) {
    return { kind: 'test', file: record.file, path: [...(record.path as string[])] };
  }
  return null;
}
