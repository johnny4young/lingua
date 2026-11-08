/**
 * Guard for `.github/workflows/ci.yml` and the scheduled renderer budget.
 *
 * The Linux gates run as parallel jobs so one red gate never hides another.
 * These assertions pin which job owns each gate, that the jobs stay parallel,
 * and the few ordering and blocking properties that still matter inside a
 * job. Windows filesystem protection and executable launching cannot rely only
 * on platform-skipped tests in the Ubuntu jobs, so a dedicated Windows job
 * stays pinned too.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { importChain, walkStaticImportGraph } from '../../scripts/lib/staticImportGraph.mjs';

const CI_WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/ci.yml');
const RENDERER_BUDGET_WORKFLOW_PATH = resolve(
  __dirname,
  '../../.github/workflows/renderer-budget.yml'
);

interface WorkflowStep {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
  'working-directory'?: string;
}

interface WorkflowJob {
  name?: string;
  if?: string;
  needs?: string | string[];
  'runs-on'?: string;
  strategy?: { 'fail-fast'?: boolean; matrix?: { shard?: number[]; os?: string[] } };
  steps?: WorkflowStep[];
}

interface Workflow {
  on?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

const LINUX_GATE_JOBS = ['static', 'unit', 'coverage', 'build-web', 'subprojects'] as const;

function readWorkflow(path: string): { raw: string; parsed: Workflow } {
  const raw = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  return { raw, parsed: (raw ? load(raw) : {}) as Workflow };
}

function stepsOf(workflow: Workflow, jobId: string): WorkflowStep[] {
  return workflow.jobs?.[jobId]?.steps ?? [];
}

function runLines(workflow: Workflow, jobId: string): string[] {
  return stepsOf(workflow, jobId).flatMap(step =>
    (step.run ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  );
}

function indexOfRun(workflow: Workflow, jobId: string, command: string): number {
  return stepsOf(workflow, jobId).findIndex(step => (step.run ?? '').includes(command));
}

describe('CI workflow', () => {
  const { raw: workflowText, parsed: workflow } = readWorkflow(CI_WORKFLOW_PATH);

  it('exists at the expected path', () => {
    expect(existsSync(CI_WORKFLOW_PATH)).toBe(true);
  });

  it('runs the Linux gates as parallel jobs on Ubuntu', () => {
    for (const jobId of LINUX_GATE_JOBS) {
      const job = workflow.jobs?.[jobId];
      expect(job, `${jobId} job`).toBeDefined();
      expect(job?.['runs-on'], `${jobId} runner`).toBe('ubuntu-latest');
      // A needs edge would put a job back behind another gate's result.
      expect(job?.needs, `${jobId} needs`).toBeUndefined();
      expect(runLines(workflow, jobId), `${jobId} installs`).toContain(
        'pnpm install --frozen-lockfile'
      );
    }
    expect(workflow.jobs?.['linux-gates']).toBeUndefined();
  });

  it('keeps every static gate in the static job', () => {
    const commands = runLines(workflow, 'static');
    for (const command of [
      'pnpm exec tsc --noEmit',
      'pnpm run typecheck:tests',
      'pnpm run lint',
      'pnpm run check:i18n',
      'pnpm run check:i18n:copy',
      'pnpm run changelog:check',
      'pnpm run check:license-rotation',
      'pnpm run check:licenses',
      'pnpm run check:prod-audit',
      'pnpm run check:bundled-audit',
    ]) {
      expect(commands, command).toContain(command);
    }
  });

  it('checks out full history where the changelog guard reads the commit range', () => {
    const checkout = stepsOf(workflow, 'static').find(step =>
      step.uses?.startsWith('actions/checkout@')
    );
    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  // The denominator has to match the matrix or part of the suite would never run.
  function expectEveryShardRuns(jobId: string, command: (total: number) => string): void {
    const job = workflow.jobs?.[jobId];
    const shards = job?.strategy?.matrix?.shard ?? [];
    const total = shards.length;
    expect(total, `${jobId} shards`).toBeGreaterThan(1);
    expect(shards).toEqual(Array.from({ length: total }, (_, index) => index + 1));
    expect(job?.strategy?.['fail-fast']).toBe(false);
    expect(job?.name).toContain('${{ matrix.shard }}/' + total);
    expect(runLines(workflow, jobId)).toContain(command(total));
    const suite = stepsOf(workflow, jobId).find(step => step.run === command(total));
    expect(suite?.env?.SHARD).toBe('${{ matrix.shard }}');
    expect(suite?.if).toBeUndefined();
  }

  it('runs the full uninstrumented suite and the template smoke in the unit job', () => {
    expectEveryShardRuns('unit', total => `pnpm test --shard="$SHARD/${total}"`);
    expect(runLines(workflow, 'unit')).toContain('pnpm run smoke:project-templates');
    const smoke = stepsOf(workflow, 'unit').find(
      step => step.run === 'pnpm run smoke:project-templates'
    );
    expect(smoke?.if).toBe('matrix.shard == 1');
  });

  it('enforces the coverage floors on the merged shards in their own job', () => {
    // test:coverage excludes the timing benches, so it cannot replace the
    // plain suite in the unit job.
    expectEveryShardRuns(
      'coverage',
      total => `pnpm run test:coverage --shard="$SHARD/${total}" --reporter=default --reporter=blob`
    );
    expect(runLines(workflow, 'unit').join('\n')).not.toContain('test:coverage');

    const floors = workflow.jobs?.['coverage-floors'];
    expect(floors?.needs).toBe('coverage');
    // Red shards must still report through this job rather than skip it.
    expect(floors?.if).toBe('${{ !cancelled() }}');
    const commands = runLines(workflow, 'coverage-floors');
    expect(commands).toContain('pnpm run test:coverage --merge-reports');
    expect(commands.join('\n')).not.toContain('--shard');
    const total = workflow.jobs?.coverage?.strategy?.matrix?.shard?.length;
    expect(commands).toContain(`test "$(find .vitest/blob -name 'blob-*.json' | wc -l)" -eq ${total}`);
  });

  it('keeps the coverage floors in force outside shard runs', () => {
    const config = readFileSync(resolve(__dirname, '../../vitest.config.mts'), 'utf-8');
    expect(config).toContain("process.argv.some(arg => arg.startsWith('--shard'))");
    expect(config).toMatch(/thresholds: isShardRun\s+\? \{\}\s+: \{\s+lines: 78,/u);
  });

  it('measures web once after its build and keeps report-writing budget/slack enforcement', () => {
    const buildIndex = indexOfRun(workflow, 'build-web', 'pnpm run build:web');
    const checkIndex = indexOfRun(workflow, 'build-web', 'pnpm run check:performance');

    expect(buildIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeGreaterThan(buildIndex);
    expect(runLines(workflow, 'build-web')).not.toContain('pnpm run performance:report');
    expect(stepsOf(workflow, 'build-web')[checkIndex]?.run).toContain('--fail-on-slack');
  });

  it('checks the existing Linux renderer bundle and keeps all three desktop OS jobs', () => {
    const job = workflow.jobs?.['desktop-bundles'];
    expect(job?.strategy?.matrix?.os).toEqual(['ubuntu-latest', 'windows-latest']);
    expect(workflow.jobs?.['desktop-bundles-macos']?.name).toBe('Desktop bundles (macos-latest)');
    expect(job?.strategy?.['fail-fast']).toBe(false);
    const steps = stepsOf(workflow, 'desktop-bundles');
    const build = indexOfRun(workflow, 'desktop-bundles', 'pnpm run build:desktop-bundles');
    const check = indexOfRun(workflow, 'desktop-bundles', 'pnpm run check:performance');
    expect(build).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(build);
    expect(steps[check]?.if).toBe("matrix.os == 'ubuntu-latest'");
    expect(steps[check]?.run).toBe('pnpm run check:performance --target=renderer --fail-on-slack');
    expect(runLines(workflow, 'desktop-bundles').filter(command => command === 'pnpm run build:desktop-bundles')).toHaveLength(1);
  });

  it('runs the bundle-config test even when the renderer budget fails', () => {
    const steps = stepsOf(workflow, 'desktop-bundles');
    const build = indexOfRun(workflow, 'desktop-bundles', 'pnpm run build:desktop-bundles');
    const check = indexOfRun(workflow, 'desktop-bundles', 'pnpm run check:performance');
    const config = indexOfRun(workflow, 'desktop-bundles', 'tests/build/desktopBundleConfig.test.ts');
    expect(config).toBeGreaterThan(check);
    expect(steps[build]?.id).toBe('bundles');
    expect(steps[config]?.if).toBe("${{ !cancelled() && steps.bundles.outcome == 'success' }}");
  });

  it('runs macOS on every push, and on a pull request whenever the path check fails', () => {
    const macos = workflow.jobs?.['desktop-bundles-macos'];
    expect(workflow.jobs?.changes?.if).toBe("github.event_name == 'pull_request'");
    expect(macos?.needs).toBe('changes');
    // A job skipped by if reports success to a required check, so a broken path check must run macOS.
    expect(macos?.if).toContain('!cancelled()');
    expect(macos?.if).toContain("needs.changes.result != 'success'");
    expect(macos?.if).toContain("github.event_name != 'pull_request'");
  });

  it('keeps the macOS job setup identical to the other desktop OS jobs', () => {
    const setup = (jobId: string) => {
      const steps = stepsOf(workflow, jobId);
      return steps.slice(0, steps.findIndex(step => step.id === 'bundles') + 1);
    };
    expect(setup('desktop-bundles-macos')).toEqual(setup('desktop-bundles'));
    expect(setup('desktop-bundles-macos').length).toBeGreaterThan(1);
  });

  describe.skipIf(process.platform === 'win32')('macOS lane on a pull request', () => {
    const pick = stepsOf(workflow, 'changes').find(step => step.id === 'pick')?.run ?? '';
    // Runs the real step script once per diff in one shell, with git replaced by a function.
    const driver = `git() { [ -z "$FAKE_GIT_FAIL" ] || return 128; printf '%s\\n' "$FAKE_DIFF"; }
for FAKE_DIFF in "$@"; do (eval "$PICK"); done`;

    function lanes(diffs: string[][], env: Record<string, string> = {}): string[] {
      const result = spawnSync('bash', ['-e', '-c', driver, 'lane', ...diffs.map(files => files.join('\n'))], {
        encoding: 'utf-8',
        env: { PATH: process.env.PATH, PICK: pick, BASE_SHA: 'base', HEAD_SHA: 'head', GITHUB_OUTPUT: '/dev/null', ...env },
      });
      expect(result.status, result.stderr).toBe(0);
      const picked = result.stdout.trim().split('\n');
      expect(picked).toHaveLength(diffs.length);
      return picked;
    }

    const lane = (files: string[], env?: Record<string, string>) => lanes([files], env)[0];

    it('skips macOS when no changed path reaches the packaged app', () => {
      const diffs = [
        ['docs/USAGE.md'],
        ['README.md', 'CHANGELOG.md'],
        ['src/renderer/App.tsx', 'src/renderer/i18n/locales/es/common.json'],
        ['src/web/main.tsx', 'tests/e2e/blockedStorage.spec.ts'],
        ['tests/components/FloatingActionPill.test.tsx', 'tests/docs/ciWorkflow.test.ts'],
        ['license-server/src/index.ts', 'update-server/src/index.ts'],
        ['.github/ISSUE_TEMPLATE/bug_report.yml', '.github/workflows/release.yml', '.github/dependabot.yml'],
      ];
      const picked = lanes(diffs);
      expect(diffs.filter((_, index) => picked[index] !== 'macos=false')).toEqual([]);
    });

    it('runs macOS for any path the packaged app or a macOS-only step reads', () => {
      const files = [
        'src/main/index.ts',
        'src/preload/index.ts',
        'src/shared/networkPolicy.ts',
        'src/cli/commands/repro.ts',
        'src/types.d.ts',
        'index.html',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        '.nvmrc',
        'electron-builder.yml',
        'vite.main.config.mts',
        'patches/monaco-editor@0.55.1.patch',
        'build-resources/entitlements.mac.plist',
        'assets/icon.icns',
        'scripts/run-desktop-smoke.mjs',
        'scripts/lib/packagedMacArtifact.mjs',
        'scripts/performance-report.mjs',
        'docs/performance/baseline.json',
        'website/src/pages/download.astro',
        'playwright.website-downloads.config.mts',
        'tests/website/downloadMatrix.spec.ts',
        'tests/build/desktopBundleConfig.test.ts',
        'tests/cli/io-fake.ts',
        'tests/shared/runCapsule.fixtures.ts',
        'src/renderer/hooks/desktopSmokeRunner.ts',
        'src/renderer/hooks/useDesktopSmoke.ts',
        '.github/workflows/ci.yml',
        '.github/actions/setup/action.yml',
      ];
      const picked = lanes(files.map(file => [file]));
      expect(files.filter((_, index) => picked[index] !== 'macos=true')).toEqual([]);
      expect(lane(['docs/USAGE.md', 'src/main/updater.ts'])).toBe('macos=true');
    });

    it('runs macOS when the diff is empty, cannot be read or has no base', () => {
      expect(lane([])).toBe('macos=true');
      expect(lane(['docs/USAGE.md'], { FAKE_GIT_FAIL: '1' })).toBe('macos=true');
      expect(lane(['docs/USAGE.md'], { BASE_SHA: '' })).toBe('macos=true');
    });

    it('runs macOS for every file the tests in the macOS job import', () => {
      const repoRoot = resolve(__dirname, '../..');
      const config = readFileSync(join(repoRoot, 'playwright.website-downloads.config.mts'), 'utf-8');
      const testDir = /testDir:\s*'\.\/([^']+)'/.exec(config)?.[1];
      const testMatch = /testMatch:\s*'([^']+)'/.exec(config)?.[1];
      const entries = [
        ...stepsOf(workflow, 'desktop-bundles-macos').flatMap(
          step => /^pnpm exec vitest run (\S+)$/.exec(step.run ?? '')?.slice(1) ?? []
        ),
        `${testDir}/${testMatch}`,
      ];
      expect(entries).toHaveLength(3);
      for (const entry of entries) {
        const { parents } = walkStaticImportGraph({ repoRoot, entry });
        const files = [...parents.keys()];
        const picked = lanes(files.map(file => [file]));
        const skipped = files.filter((_, index) => picked[index] !== 'macos=true');
        expect(skipped.map(file => importChain(parents, file).join(' > '))).toEqual([]);
      }
    });
  });

  it('qualifies native output in the macOS PR app without replacing existing gates', () => {
    const steps = stepsOf(workflow, 'desktop-bundles-macos');
    const build = steps.findIndex(step => step.run === 'pnpm run build:desktop-bundles');
    const smoke = steps.findIndex(step => step.run === 'node scripts/smoke-native-output.mjs');
    expect(smoke).toBeGreaterThan(build);
    expect(steps[smoke]?.if).toBeUndefined();
    expect(steps[smoke]?.['continue-on-error']).toBeUndefined();
    const evidence = steps.find(step => step.name === 'Upload native output smoke evidence');
    expect(evidence?.if).toContain('always()');
    expect(evidence?.with?.path).toContain('native-output/result.json');
    expect(evidence?.with?.path).not.toContain('profile');
  });

  it('runs the Seatbelt containment fixtures on every macOS run as a blocking gate', () => {
    const steps = stepsOf(workflow, 'desktop-bundles-macos');
    const fixtures = steps.find(
      step => step.run === 'pnpm exec vitest run tests/cli/runtime/seatbeltContainment.test.ts'
    );

    expect(fixtures?.if).toBeUndefined();
    expect(fixtures?.['continue-on-error']).toBeUndefined();
  });

  it('gates the independently managed update-server and website in the subprojects job', () => {
    const steps = stepsOf(workflow, 'subprojects');
    const updateServer = steps.find(step => step['working-directory'] === 'update-server');
    const website = steps.find(step => step['working-directory'] === 'website');
    expect(updateServer?.run).toContain('pnpm run typecheck');
    expect(updateServer?.run).toContain('pnpm test');
    expect(website?.run).toContain('npm ci --no-audit --no-fund');
    expect(website?.run).toContain('npm test');
  });

  it('runs Windows platform-boundary coverage on a Windows runner', () => {
    expect(workflow.jobs?.['windows-path-hardening']?.['runs-on']).toBe('windows-latest');
    expect(workflowText).toMatch(
      /windows-path-hardening:[\s\S]*?pnpm exec vitest run[\s\S]*?tests\/ipc\/permissions\.test\.ts/u
    );
    expect(workflowText).toMatch(
      /windows-path-hardening:[\s\S]*?tests\/main\/dependencies\.install\.windows\.test\.ts/u
    );
    expect(workflowText).toMatch(
      /windows-path-hardening:[\s\S]*?Windows standalone CLI packaging smoke[\s\S]*?pnpm run package:cli -- --binary-only --expect-target windows-x64/u
    );
  });

  it('shards the end-to-end suite across parallel runners', () => {
    const job = workflow.jobs?.['web-e2e'];
    const shards = job?.strategy?.matrix?.shard ?? [];
    const total = shards.length;
    expect(total).toBeGreaterThan(1);
    expect(shards).toEqual(Array.from({ length: total }, (_, index) => index + 1));
    // One red shard must not cancel the results of the others.
    expect(job?.strategy?.['fail-fast']).toBe(false);

    const steps = stepsOf(workflow, 'web-e2e');
    const suite = steps.find(step => step.name === 'Web end-to-end suite');
    // The shard index arrives through the environment, and the denominator
    // has to match the matrix or part of the suite would never run.
    expect(suite?.run).toBe('pnpm run test:e2e:web --shard="$SHARD/' + total + '"');
    expect(suite?.env?.SHARD).toBe('${{ matrix.shard }}');
    expect(job?.name).toContain('${{ matrix.shard }}/' + total);
    expect(suite?.env?.PWTEST_SHARD_WEIGHTS?.split(':')).toHaveLength(total);

    // Artifact names must be unique within a workflow run.
    const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
    expect(String(upload?.with?.name)).toContain('${{ matrix.shard }}');
  });

  it('installs Chromium fresh instead of caching it per pull request', () => {
    const steps = stepsOf(workflow, 'web-e2e');
    // Entries saved on a PR ref only serve that PR, and they crowded the repo's 10 GB cache.
    expect(steps.some(step => step.uses?.startsWith('actions/cache@'))).toBe(false);
    const install = steps.find(step => step.name === 'Install Chromium');
    expect(install?.run).toBe('pnpm exec playwright install --with-deps chromium');
    expect(install?.if).toBeUndefined();
  });

  it('checks the desktop footprint budget right after the packaged smoke on macOS', () => {
    const steps = stepsOf(workflow, 'desktop-bundles-macos');
    const smoke = steps.findIndex(step => step.run === 'pnpm run smoke:desktop:packaged');
    const budget = steps.findIndex(step => step.name === 'Desktop memory budget');
    expect(budget).toBe(smoke + 1);
    expect(steps[budget]?.run).toBe('pnpm run check:performance --memory');
    expect(steps[budget]?.if).toBe(steps[smoke]?.if);
    expect(steps[budget]?.['continue-on-error']).toBeUndefined();
  });

  it('keeps the end-to-end and Windows jobs on pull requests only', () => {
    expect(workflow.jobs?.['web-e2e']?.if).toBe("github.event_name == 'pull_request'");
    expect(workflow.jobs?.['windows-path-hardening']?.if).toBe(
      "github.event_name == 'pull_request'"
    );
  });

  it("uses pnpm audit's supported advisory threshold option", () => {
    expect(runLines(workflow, 'static')).toContain('pnpm audit --audit-level high');
    expect(workflowText).not.toContain('pnpm audit --internal');
  });

  it('blocks production advisories in every independently locked package', () => {
    const commands = runLines(workflow, 'static');
    expect(commands).toContain('pnpm --dir license-server audit --prod --audit-level high || failed=1');
    expect(commands).toContain('pnpm --dir update-server audit --prod --audit-level high || failed=1');
    expect(commands).toContain('pnpm run check:website-audit || failed=1');
  });

  it('runs every independent audit before failing so one red graph cannot mask another', () => {
    const step = stepsOf(workflow, 'static').find(
      candidate => candidate.name === 'Independent production dependency audits (blocking)'
    );
    const lines = (step?.run ?? '').split('\n').map(line => line.trim()).filter(Boolean);
    expect(lines[0]).toBe('failed=0');
    expect(lines.at(-1)).toBe('exit "$failed"');
    const audits = lines.slice(1, -1);
    expect(audits).toHaveLength(3);
    for (const line of audits) expect(line).toMatch(/ \|\| failed=1$/u);
    expect(step?.['continue-on-error']).toBeUndefined();
  });

  it('keeps every gate blocking except the advisory i18n inventory and full-graph audit', () => {
    // `pnpm audit --prod` reads package.json "dependencies" only, so a
    // devDependency imported by src/main (undici, ws) ships inside
    // .vite/build/main.js with the production gate green. The bundled audit
    // closes that hole and has to stay blocking, like every other gate.
    const advisory = Object.entries(workflow.jobs ?? {}).flatMap(([jobId, job]) =>
      (job.steps ?? [])
        .filter(step => step['continue-on-error'] === true)
        .map(step => `${jobId}: ${step.name ?? step.run ?? ''}`)
    );
    expect(advisory).toEqual([
      'static: i18n usage inventory (advisory)',
      'static: Security audit (advisory, full graph)',
    ]);
  });
});

describe('renderer budget workflow', () => {
  const { parsed: workflow } = readWorkflow(RENDERER_BUDGET_WORKFLOW_PATH);

  it('exists at the expected path', () => {
    expect(existsSync(RENDERER_BUDGET_WORKFLOW_PATH)).toBe(true);
  });

  it('runs on a schedule and on demand, never per pull request or push', () => {
    const triggers = Object.keys(workflow.on ?? {}).sort();
    expect(triggers).toEqual(['schedule', 'workflow_dispatch']);
  });

  it('checks every baseline target, the desktop renderer included, with slack fatal', () => {
    const commands = runLines(workflow, 'renderer-budget');
    expect(commands).toContain('pnpm run build:web');
    expect(commands).toContain('pnpm run build:desktop-bundles');
    const check = commands.find(command => command.startsWith('pnpm run check:performance'));
    expect(commands).not.toContain('pnpm run performance:report');
    expect(commands.filter(command => command.startsWith('pnpm run check:performance'))).toHaveLength(1);
    expect(check).toContain('--require-all-targets');
    expect(check).toContain('--fail-on-slack');
  });
});
