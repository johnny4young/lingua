import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpPipelineManager } from '../../../src/renderer/components/HttpWorkspace/HttpPipelineManager';
import {
  resetWorkspaceToolStoreForTests,
  useWorkspaceToolStore,
} from '../../../src/renderer/stores/workspaceToolStore';
import { createBlankHttpRequest } from '../../../src/shared/httpWorkspaceSchema';
import type { HttpPipelineRunSnapshot } from '../../../src/shared/httpPipeline';

describe('HttpPipelineManager', () => {
  beforeEach(() => {
    resetWorkspaceToolStoreForTests();
    useWorkspaceToolStore.getState().createRequest({
      ...createBlankHttpRequest({ id: 'request-1', name: 'Create session' }),
      url: 'https://api.example.com/session',
    });
  });

  it('creates a pipeline, adds an HTTP request, and exposes it to the runner', async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <HttpPipelineManager
        onClose={vi.fn()}
        run={null}
        onRun={onRun}
        onStop={vi.fn()}
      />
    );

    await user.click(
      screen.getAllByRole('button', { name: 'New pipeline' })[0]!
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Add request' }),
      'request-1'
    );
    await user.click(screen.getByRole('button', { name: 'Run pipeline' }));

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Untitled pipeline',
        stopOnFailure: true,
        steps: [
          expect.objectContaining({ requestId: 'request-1', enabled: true }),
        ],
      })
    );
  });

  describe('read as a run', () => {
    const NOW = '2026-11-20T10:00:00.000Z';
    const seedPipeline = () => {
      const store = useWorkspaceToolStore.getState();
      store.createRequests([
        {
          ...createBlankHttpRequest({ id: 'deploy', name: 'Create deploy' }),
          method: 'POST',
          url: '{{baseUrl}}/v1/deploys',
          captures: [{ id: 'c1', source: 'body-json', path: 'id', targetVariable: 'deployId', enabled: true }],
        },
        { ...createBlankHttpRequest({ id: 'health', name: 'Service health' }), url: '{{baseUrl}}/v1/services/{{deployId}}' },
        {
          ...createBlankHttpRequest({ id: 'notify', name: 'Notify' }),
          method: 'POST',
          url: 'https://hooks.example.com/notify?deploy={{deployId}}&env={{baseUrl}}',
        },
      ]);
      store.createHttpPipeline({
        version: 1,
        id: 'p1',
        name: 'deploy, then verify',
        steps: [
          { id: 's1', requestId: 'deploy', enabled: true },
          { id: 's2', requestId: 'health', enabled: true },
          { id: 's3', requestId: 'notify', enabled: true },
          { id: 's4', requestId: 'request-1', enabled: false },
        ],
        stopOnFailure: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
      store.createHttpPipeline({ version: 1, id: 'p2', name: 'smoke', steps: [], stopOnFailure: false, createdAt: NOW, updatedAt: NOW });
      store.setActiveHttpPipeline('p1');
    };
    const failedRun: HttpPipelineRunSnapshot = {
      pipelineId: 'p1',
      startedAt: NOW,
      finishedAt: NOW,
      phase: 'failed',
      results: [
        {
          stepId: 's1',
          requestId: 'deploy',
          status: 'passed',
          httpStatus: 201,
          responseKind: 'success',
          report: { durationMs: 412, statusText: 'Created', captures: [{ variable: 'deployId', from: 'body.id', value: '"dep_81f2"' }] },
        },
        {
          stepId: 's2',
          requestId: 'health',
          status: 'failed',
          httpStatus: 200,
          responseKind: 'success',
          assertionFailures: 1,
          report: {
            durationMs: 142,
            statusText: 'OK',
            captures: [],
            check: { expression: 'body.items[0].status == "healthy"', pass: false, received: '"degraded"', count: 2 },
          },
        },
        { stepId: 's3', requestId: 'notify', status: 'skipped', message: 'stopped-on-failure' },
      ],
    };
    const renderManager = (run: HttpPipelineRunSnapshot | null, onClose = vi.fn()) =>
      render(<HttpPipelineManager onClose={onClose} run={run} onRun={vi.fn()} onStop={vi.fn()} />);
    const steps = () => screen.getAllByTestId('http-pipeline-step');

    it('heads the run with passes over the steps it covered, total time and where it stopped', () => {
      seedPipeline();
      renderManager(failedRun);
      const header = screen.getByTestId('result-header');
      expect(within(header).getByTestId('result-header-workspace').textContent).toBe('PIPE');
      expect(screen.getByTestId('http-pipeline-passed').textContent).toBe('1of 3 passed');
      expect(header.textContent).toContain('554 ms · stopped at step 2');
      const bar = screen.getByTestId('http-pipeline-phases');
      expect([...bar.querySelectorAll('[data-phase]')].map((segment) => segment.getAttribute('data-phase'))).toEqual(['s1', 's2']);
      expect((bar.querySelectorAll('[data-phase]')[1] as HTMLElement).style.background).toBe('var(--color-value-error)');
    });

    it('reads each step: status numeral, time bar, captures where made and used, and the failed check', () => {
      seedPipeline();
      renderManager(failedRun);
      const [deploy, health, notify, off] = steps();
      expect(deploy!.dataset.status).toBe('passed');
      expect(within(deploy!).getByTestId('http-pipeline-step-numeral').textContent).toBe('201created');
      expect(within(deploy!).getByText('/v1/deploys')).not.toBeNull();
      expect(within(deploy!).getByTestId('http-pipeline-step-time').textContent).toBe('412 ms');
      expect(within(deploy!).getByTestId('http-pipeline-step-bar').style.width).toBe('100%');
      expect(within(deploy!).getByTestId('http-pipeline-step-capture').textContent).toBe('captures{{deployId}}← body.id"dep_81f2"');

      expect(health!.dataset.status).toBe('failed');
      expect(within(health!).getByTestId('http-pipeline-step-numeral').getAttribute('data-tone')).toBe('error');
      // Square-root scale, as in the HTTP history, so a fast step never flattens to a dot.
      expect(within(health!).getByTestId('http-pipeline-step-bar').style.width).toBe(`${Math.sqrt(142 / 412) * 100}%`);
      expect(within(health!).getByTestId('http-pipeline-variable').hasAttribute('data-chained')).toBe(true);
      expect(within(health!).getAllByTestId('http-pipeline-variable').map((token) => token.textContent)).toEqual(['{{deployId}}']);
      const check = within(health!).getByTestId('http-pipeline-step-check');
      expect(check.dataset.pass).toBe('false');
      expect(check.textContent).toBe('body.items[0].status == "healthy"received"degraded"+1 more');

      expect(notify!.dataset.status).toBe('skipped');
      expect(notify!.hasAttribute('data-dim')).toBe(true);
      expect(notify!.textContent).toContain('not reached — the pipeline stopped at step 2');
      // Only values an earlier step captures are what it would send; the base URL is environment.
      expect(within(notify!).getByText(/would send/).textContent).toBe('would send {{deployId}}');
      expect(within(notify!).getByText('/notify?deploy=', { exact: false }).getAttribute('title')).toContain('Notify');

      expect(off!.dataset.status).toBe('pending');
      expect(off!.hasAttribute('data-dim')).toBe(true);
    });

    it('reads a run of another pipeline as not run, and switches stop-on-failure and goes back', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      seedPipeline();
      useWorkspaceToolStore.getState().setActiveHttpPipeline('p2');
      renderManager(failedRun, onClose);
      expect(screen.queryByTestId('http-pipeline-passed')).toBeNull();
      expect(screen.getByText('Ready to run locally.')).not.toBeNull();

      const toggle = screen.getByRole('switch', { name: 'Stop after a failure' });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      await user.click(toggle);
      expect(useWorkspaceToolStore.getState().httpPipelines.find((pipeline) => pipeline.id === 'p2')?.stopOnFailure).toBe(true);
      await user.click(screen.getByTestId('http-pipeline-back'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('marks the running step and keeps its order locked until the run settles', () => {
      seedPipeline();
      renderManager({ pipelineId: 'p1', startedAt: NOW, phase: 'running', activeStepId: 's2', results: [failedRun.results[0]!] });
      expect(steps()[1]!.dataset.status).toBe('running');
      expect(screen.getByTestId('result-header').textContent).toContain('412 ms · running step 2');
      expect(screen.getByTestId('http-pipeline-stop')).not.toBeNull();
      expect(within(steps()[0]!).getByRole('button', { name: 'Remove step' }).hasAttribute('disabled')).toBe(true);
      expect((within(steps()[0]!).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
      // The runner holds the pipeline it started: edits made now would not reach it.
      expect((screen.getByRole('switch', { name: 'Stop after a failure' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('combobox', { name: 'Add request' }) as HTMLSelectElement).disabled).toBe(true);
    });

    it('keys repeated variables and captures by position, and reads a whole-ms total', () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const store = useWorkspaceToolStore.getState();
      store.createRequest({
        ...createBlankHttpRequest({ id: 'twice', name: 'Twice' }),
        url: '{{baseUrl}}/orgs/{{id}}/users/{{id}}',
        captures: [
          { id: 'c1', source: 'header', path: 'x-token', targetVariable: 'tag', enabled: true },
          { id: 'c2', source: 'body-json', path: 'tag', targetVariable: 'tag', enabled: true },
        ],
      });
      store.createHttpPipeline({ version: 1, id: 'p3', name: 'twice', steps: [{ id: 't1', requestId: 'twice', enabled: true }], stopOnFailure: true, createdAt: NOW, updatedAt: NOW });
      store.setActiveHttpPipeline('p3');
      renderManager({
        pipelineId: 'p3',
        startedAt: NOW,
        phase: 'completed',
        results: [
          {
            stepId: 't1',
            requestId: 'twice',
            status: 'passed',
            httpStatus: 200,
            report: {
              durationMs: 1240,
              statusText: 'OK',
              captures: [
                { variable: 'tag', from: 'header x-token', value: '"a"' },
                { variable: 'tag', from: 'body.tag', value: '"b"' },
              ],
            },
          },
        ],
      });
      expect(screen.getAllByTestId('http-pipeline-variable').map((token) => token.textContent)).toEqual(['{{id}}', '{{id}}', '{{tag}}', '{{tag}}']);
      expect(screen.getAllByTestId('http-pipeline-step-capture')).toHaveLength(2);
      expect(screen.getByTestId('result-header').textContent).toContain('1.2 s');
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });
});
