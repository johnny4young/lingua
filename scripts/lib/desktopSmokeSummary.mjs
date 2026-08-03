/**
 * Validate the renderer-owned desktop-smoke artifacts independently from the
 * launcher exit code. macOS LaunchServices can return zero even when the
 * detached Electron process later reports a failed smoke run, so the JSON
 * artifacts are the authority.
 */
export function inspectDesktopSmokeResult(summary, progress) {
  const problems = [];
  const cases = Array.isArray(summary?.cases) ? summary.cases : [];
  const failedCases = cases.filter(item => item?.ok !== true);

  if (!Array.isArray(summary?.cases)) {
    problems.push('Smoke summary is missing its cases array.');
  } else if (cases.length === 0) {
    problems.push('Smoke summary contains no executed cases.');
  }

  if (typeof summary?.error === 'string' && summary.error.trim().length > 0) {
    problems.push(`Renderer smoke error: ${summary.error.trim()}`);
  }

  if (progress?.status !== 'completed') {
    const status = typeof progress?.status === 'string' ? progress.status : 'missing';
    problems.push(`Smoke progress status is ${status}, expected completed.`);
  }

  return {
    ok: problems.length === 0 && failedCases.length === 0,
    cases,
    failedCases,
    problems,
  };
}
