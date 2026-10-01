import { computeContentHash } from '../../shared/runCapsule';
import {
  MAX_REGRESSION_SUITE_BYTES,
  parseCapsuleRegressionSuite,
} from '../../shared/capsuleRegressionSuite';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { readBoundedSuite, readRegressionTarget } from '../runtime/regressionTargets';
import { verifyCapsuleBaseline, type VerifyCapsuleArgs } from './capsuleVerify';
import { emitPreflightError } from './run';

const REGRESSION_SUITE_BUDGET_MS = 5 * 60_000;
export async function runVerifyCapsuleSuiteCommand(
  args: VerifyCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const deadline = Date.now() + REGRESSION_SUITE_BUDGET_MS;
  const fail = (reason: string) =>
    emitPreflightError(
      args,
      io,
      reason,
      'Invalid regression suite; no code executed.',
      CLI_EXIT_CODES.userInputError,
      { command: 'capsule-verify-suite', verdict: 'inconclusive' },
      'lingua capsule verify-suite'
    );
  let raw;
  try {
    raw = await readBoundedSuite(args.filePath, MAX_REGRESSION_SUITE_BYTES);
  } catch (error) {
    return fail(
      error instanceof Error && error.message === 'suite-too-large'
        ? 'suite-too-large'
        : 'suite-read-failed'
    );
  }
  const parsed = parseCapsuleRegressionSuite(raw);
  if (!parsed.ok) return fail(parsed.reason);
  // Validate every oracle and target before the first case can spawn a process.
  for (const testCase of parsed.suite.cases) {
    if (
      (await computeContentHash(testCase.baseline.source.content)) !==
      testCase.baseline.source.contentHash
    )
      return fail('content-hash-mismatch');
    try {
      await readRegressionTarget(
        args.rootDirectory ?? process.cwd(),
        testCase.target,
        testCase.baseline.tab.language,
        MAX_REGRESSION_SUITE_BYTES
      );
    } catch {
      return fail('invalid-regression-target');
    }
  }
  const cases: Array<Record<string, unknown>> = [];
  const exits: CliExitCode[] = [];
  for (const testCase of parsed.suite.cases) {
    if (Date.now() >= deadline - 100) {
      exits.push(CLI_EXIT_CODES.verificationInconclusive);
      cases.push({
        id: testCase.id,
        name: testCase.name,
        target: testCase.target,
        ok: false,
        verdict: 'inconclusive',
        skipped: true,
        reason: 'suite-budget-exhausted',
      });
      continue;
    }
    let report = '';
    const code = await verifyCapsuleBaseline(
      testCase.baseline,
      { ...args, targetPath: testCase.target, deadline, json: true, quiet: false },
      {
        ...io,
        writeStdout: text => {
          report += text;
        },
        writeStderr: () => {},
      }
    );
    exits.push(code);
    cases.push({
      ...JSON.parse(report),
      id: testCase.id,
      name: testCase.name,
      target: testCase.target,
      exitCode: code,
    });
  }
  const summary = {
    total: cases.length,
    passed: cases.filter(c => c.verdict === 'pass').length,
    failed: cases.filter(c => c.verdict === 'fail').length,
    inconclusive: cases.filter(c => c.verdict === 'inconclusive').length,
    skipped: cases.filter(c => c.skipped).length,
  };
  const verdict = summary.failed ? 'fail' : summary.inconclusive ? 'inconclusive' : 'pass';
  const result = {
    ok: verdict === 'pass',
    command: 'capsule-verify-suite',
    suiteVersion: 1,
    verdict,
    summary,
    cases,
  };
  if (args.json) io.writeStdout(`${JSON.stringify(result)}\n`);
  else if (!args.quiet)
    io.writeStdout(
      `lingua capsule verify-suite: ${verdict} (${summary.passed}/${summary.total} passed, ${summary.failed} drift, ${summary.inconclusive} inconclusive)\n`
    );
  return (
    exits.find(code => code > 0 && code < 5) ??
    (verdict === 'fail'
      ? CLI_EXIT_CODES.verificationFailed
      : verdict === 'inconclusive'
        ? CLI_EXIT_CODES.verificationInconclusive
        : CLI_EXIT_CODES.ok)
  );
}
