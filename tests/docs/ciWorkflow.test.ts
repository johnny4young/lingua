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

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/ci.yml');
const RENDERER_BUDGET_WORKFLOW_PATH = resolve(
  __dirname,
  '../../.github/workflows/renderer-budget.yml'
);

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
  'working-directory'?: string;
}

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  'runs-on'?: string;
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

  it('runs the full uninstrumented suite and the template smoke in the unit job', () => {
    const commands = runLines(workflow, 'unit');
    expect(commands).toContain('pnpm test');
    expect(commands).toContain('pnpm run smoke:project-templates');
  });

  it('enforces the coverage floors in their own job', () => {
    // test:coverage excludes the timing benches, so it cannot replace the
    // plain suite in the unit job.
    expect(runLines(workflow, 'coverage')).toContain('pnpm run test:coverage');
    expect(runLines(workflow, 'unit')).not.toContain('pnpm run test:coverage');
  });

  it('runs the performance budget check after the web build report, with slack fatal', () => {
    const buildIndex = indexOfRun(workflow, 'build-web', 'pnpm run build:web');
    const reportIndex = indexOfRun(workflow, 'build-web', 'pnpm run performance:report');
    const checkIndex = indexOfRun(workflow, 'build-web', 'pnpm run check:performance');

    expect(buildIndex).toBeGreaterThan(-1);
    expect(reportIndex).toBeGreaterThan(buildIndex);
    expect(checkIndex).toBeGreaterThan(reportIndex);
    expect(stepsOf(workflow, 'build-web')[checkIndex]?.run).toContain('--fail-on-slack');
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
    expect(commands).toContain('pnpm --dir license-server audit --prod --audit-level high');
    expect(commands).toContain('pnpm --dir update-server audit --prod --audit-level high');
    expect(commands).toContain(
      'npm --prefix website audit --package-lock-only --omit=dev --audit-level=high'
    );
  });

  it('keeps every gate blocking except the advisory full-graph audit', () => {
    // `pnpm audit --prod` reads package.json "dependencies" only, so a
    // devDependency imported by src/main (undici, ws) ships inside
    // .vite/build/main.js with the production gate green. The bundled audit
    // closes that hole and has to stay blocking, like every other gate.
    const advisory = Object.entries(workflow.jobs ?? {}).flatMap(([jobId, job]) =>
      (job.steps ?? [])
        .filter(step => step['continue-on-error'] === true)
        .map(step => `${jobId}: ${step.name ?? step.run ?? ''}`)
    );
    expect(advisory).toEqual(['static: Security audit (advisory, full graph)']);
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
    expect(check).toContain('--require-all-targets');
    expect(check).toContain('--fail-on-slack');
  });
});
