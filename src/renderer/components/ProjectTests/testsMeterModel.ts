import type { ProjectTestCaseStatus } from '../../../shared/projectTests';
import type { ProjectTestDisplayCase, ProjectTestRunSummary } from '../../stores/projectTestStore';

export type TestStatusCounts = Record<ProjectTestCaseStatus | 'notRun', number>;

/** Tests by status; a result kept from an earlier run counts as not run. */
export function countByStatus(cases: readonly ProjectTestDisplayCase[]): TestStatusCounts {
  const counts = { passed: 0, failed: 0, skipped: 0, notRun: 0 };
  for (const entry of cases) counts[entry.stale ? 'notRun' : entry.status] += 1;
  return counts;
}

export interface TestsMeterBar {
  /** Failed share of the run's counted tests, 0–1; the passed share is the rest. */
  failed: number;
  /** A run that reported no counted tests (stopped, timed out, build failure) draws a stub. */
  empty: boolean;
  latest: boolean;
  summary: ProjectTestRunSummary;
}

/** The project's last runs as stacked bars: failed on top, passed below, all the same height. */
export function testsMeterBars(runs: readonly ProjectTestRunSummary[]): TestsMeterBar[] {
  return runs.map((summary, index) => {
    const counted = summary.passed + summary.failed;
    return {
      failed: counted === 0 ? 0 : summary.failed / counted,
      empty: counted === 0,
      latest: index === runs.length - 1,
      summary,
    };
  });
}
