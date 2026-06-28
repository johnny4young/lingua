/**
 * RL-099 Slice 1 — UtilityPipelinePanel tests.
 *
 * Focused on the orchestration the panel owns: create + add step +
 * run + result rendering. Adapter behavior is covered by the unit
 * tests; this suite just verifies the wiring.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

// Partial-mock the capsule builder so a single test can force a build
// failure (the saveFailed branch) while every other test exercises the
// real builder. `vi.fn(actual.buildPipelineCapsule)` delegates by
// default; the failure test overrides one call with mockRejectedValueOnce.
vi.mock('../../../src/renderer/runtime/pipelineCapsule', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/renderer/runtime/pipelineCapsule')>();
  return { ...actual, buildPipelineCapsule: vi.fn(actual.buildPipelineCapsule) };
});

import { UtilityPipelinePanel } from '../../../src/renderer/components/DeveloperUtilities/UtilityPipelinePanel';
import { buildPipelineCapsule } from '../../../src/renderer/runtime/pipelineCapsule';
import {
  resetUtilityPipelineStoreForTests,
  useUtilityPipelineStore,
} from '../../../src/renderer/stores/utilityPipelineStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useExecutionHistoryStore } from '../../../src/renderer/stores/executionHistoryStore';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';
import { useAnnouncerStore } from '../../../src/renderer/stores/announcerStore';
import { createBlankPipeline, createBlankStep } from '../../../src/shared/utilityPipeline';

function setFreeTier() {
  useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
}

function setProTier() {
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'pipeline@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

beforeEach(() => {
  localStorage.clear();
  resetUtilityPipelineStoreForTests();
  useSettingsStore.setState({ utilitiesClipboardOnFocusConsent: 'declined' });
  useUIStore.setState({ statusNotice: null });
  useExecutionHistoryStore.getState().clear();
  useAnnouncerStore.setState({ message: '', nonce: 0 });
  mockTrackEvent.mockClear();
  setProTier();
});

describe('UtilityPipelinePanel', () => {
  it('renders a locked workflow card on Free', async () => {
    setFreeTier();
    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);

    expect(screen.getByTestId('utility-pipeline-locked')).toBeTruthy();
    expect(screen.queryByTestId('utility-pipeline-panel')).toBeNull();

    await user.click(screen.getByTestId('utility-pipeline-unlock'));
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
  });

  it('renders the empty state when no pipeline is selected', () => {
    render(<UtilityPipelinePanel />);
    expect(screen.getByTestId('utility-pipeline-panel')).toBeTruthy();
    expect(screen.getByText(/no pipelines yet/i)).toBeTruthy();
  });

  it('import panel: Escape dismisses it, returns focus to the trigger, and does not bubble (UX Sweep T3)', async () => {
    const user = userEvent.setup();
    // Stands in for the Developer Utilities overlay's own Escape handler.
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <UtilityPipelinePanel />
      </div>
    );

    const trigger = screen.getByTestId('utility-pipeline-list-import');
    await user.click(trigger);
    const textarea = await screen.findByTestId('utility-pipeline-import-textarea');
    await waitFor(() => expect(document.activeElement).toBe(textarea));

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('utility-pipeline-import-panel')).toBeNull()
    );
    // Focus returns to the trigger, not the document body.
    expect(document.activeElement).toBe(trigger);
    // stopPropagation kept the overlay above from closing on the same Esc.
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('shows the template gallery in the empty state (RL-099 Slice 5)', () => {
    render(<UtilityPipelinePanel />);
    expect(screen.getByTestId('pipeline-template-gallery')).toBeTruthy();
    // One card per catalog template (9 after RL-099 Slice 7 fold D added
    // the inspect-hidden-chars starter).
    expect(screen.getAllByTestId('pipeline-template-card')).toHaveLength(9);
  });

  it('Use template creates + selects a pipeline, seeds the sample input, fires telemetry', async () => {
    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);
    const useBtn = document.querySelector(
      '[data-testid="pipeline-template-use"][data-template-id="slugify"]'
    ) as HTMLButtonElement;
    expect(useBtn).toBeTruthy();
    await user.click(useBtn);

    await waitFor(() => {
      expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(1);
    });
    const state = useUtilityPipelineStore.getState();
    const created = state.pipelines[0]!;
    expect(state.activePipelineId).toBe(created.id);
    expect(created.steps.map((s) => s.utilityId)).toEqual(['slugify']);
    expect(created.steps[0]!.options).toEqual({
      separator: 'hyphen',
      lowercase: true,
    });
    // Fold F — the sample input is seeded so the pipeline is runnable.
    expect(state.getPipelineInput(created.id)).toBe('Hello World Example');
    // Fold A — adoption telemetry with the curated template id.
    expect(mockTrackEvent).toHaveBeenCalledWith('utility.pipeline_template_used', {
      templateId: 'slugify',
    });
  });

  it('creates a pipeline via the New button', async () => {
    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);
    await user.click(screen.getByTestId('utility-pipeline-list-create'));
    await waitFor(() => {
      expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(1);
    });
    expect(screen.getByTestId('utility-pipeline-editor-add-step')).toBeTruthy();
  });

  it('adds + runs a 2-step pipeline (Base64 decode → JSON format)', async () => {
    // Seed a ready-to-run pipeline directly so we skip the dropdown
    // selection ceremony in the test.
    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'base64-decode' }));
    pipeline.steps.push(createBlankStep({ id: 's2', utilityId: 'json-format' }));
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    useUtilityPipelineStore.getState().setPipelineInput('p1', 'eyJhIjoxfQ==');

    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);
    await user.click(screen.getByTestId('utility-pipeline-editor-run'));

    await waitFor(() => {
      const rows = screen.getAllByTestId('utility-pipeline-result-row');
      expect(rows).toHaveLength(2);
    });
    const outputs = screen
      .getAllByTestId('utility-pipeline-result-output')
      .map(el => el.textContent ?? '');
    expect(outputs[0]).toContain('{"a":1}');
    expect(outputs[1]).toContain('"a": 1');

    // UX Sweep T4 — the run result is announced to screen readers.
    expect(useAnnouncerStore.getState().message).toContain('2 of 2 steps succeeded');
  });

  it('cascades skipped status when an upstream step fails', async () => {
    const pipeline = createBlankPipeline({ id: 'p1' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'json-format' }));
    pipeline.steps.push(createBlankStep({ id: 's2', utilityId: 'base64-encode' }));
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    useUtilityPipelineStore.getState().setPipelineInput('p1', 'not-json');

    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);
    await user.click(screen.getByTestId('utility-pipeline-editor-run'));

    await waitFor(() => {
      const rows = screen.getAllByTestId('utility-pipeline-result-row');
      expect(rows).toHaveLength(2);
      expect(rows[0]?.getAttribute('data-status')).toBe('error');
      expect(rows[1]?.getAttribute('data-status')).toBe('skipped');
    });
  });

  it('disables Run when the active pipeline has zero steps', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'empty' });
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    render(<UtilityPipelinePanel />);
    const runBtn = screen.getByTestId('utility-pipeline-editor-run') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
  });

  it('renames the active pipeline inline', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'old-name' });
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);
    const nameInput = screen.getByTestId('utility-pipeline-list-name') as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'renamed pipeline');
    await waitFor(() => {
      expect(useUtilityPipelineStore.getState().pipelines[0]?.name).toBe('renamed pipeline');
    });
  });

  it('deletes a pipeline only after the ConfirmDialog is confirmed (UX Sweep T2)', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'doomed' });
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);

    await user.click(screen.getByTestId('utility-pipeline-list-delete'));

    // The native window.confirm is gone; a ConfirmDialog gates the delete.
    expect(screen.getByTestId('utility-pipeline-delete-confirm')).toBeTruthy();
    expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(1);

    // Cancel aborts with no mutation.
    await user.click(screen.getByTestId('utility-pipeline-delete-confirm-cancel'));
    expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(1);
    expect(screen.queryByTestId('utility-pipeline-delete-confirm')).toBeNull();

    // Re-open and confirm — the pipeline is deleted.
    await user.click(screen.getByTestId('utility-pipeline-list-delete'));
    await user.click(screen.getByTestId('utility-pipeline-delete-confirm-confirm'));
    await waitFor(() => {
      expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(0);
    });
  });

  it('reveals the hover-only row actions for keyboard users and rings them (UX Sweep T1 fold B)', () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'one' });
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    render(<UtilityPipelinePanel />);

    expect(screen.getByTestId('utility-pipeline-list-row').className).toContain(
      'focus-ring'
    );

    for (const testId of [
      'utility-pipeline-list-duplicate',
      'utility-pipeline-list-delete',
    ]) {
      const button = screen.getByTestId(testId);
      expect(button.className).toContain('focus-ring');
      // Hover-only actions must also surface when a keyboard user focuses
      // into the row, otherwise they are invisible to Tab navigation.
      expect(button.className).toContain('group-focus-within:opacity-100');
      expect(button.className).toContain('focus-visible:opacity-100');
    }
  });

  // RL-099 Slice 3 fold A — explicit Save-as-capsule button.
  it('disables Save-as-capsule before a run completes', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'json-format' }));
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    useUtilityPipelineStore.getState().setPipelineInput('p1', '{"a":1}');

    render(<UtilityPipelinePanel />);
    const saveBtn = screen.getByTestId('pipeline-save-capsule') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('records a pipeline capsule + fires capsule.exported on Save-as-capsule', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'json-format' }));
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    useUtilityPipelineStore.getState().setPipelineInput('p1', '{"a":1}');

    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);

    // The run is NOT auto-recorded — nothing in the history ring yet.
    await user.click(screen.getByTestId('utility-pipeline-editor-run'));
    await waitFor(() => {
      const saveBtn = screen.getByTestId('pipeline-save-capsule') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });
    expect(useExecutionHistoryStore.getState().latestCapsule()).toBeNull();

    // Explicit click records the capsule into the history ring.
    await user.click(screen.getByTestId('pipeline-save-capsule'));
    await waitFor(() => {
      const capsule = useExecutionHistoryStore.getState().latestCapsule();
      expect(capsule?.tab.language).toBe('pipeline');
      expect(capsule?.environment.runner).toBe('utility-pipeline');
    });

    // …and fires the widened capsule.exported trigger.
    const exportCall = mockTrackEvent.mock.calls.find(
      call => call[0] === 'capsule.exported'
    );
    expect(exportCall).toBeDefined();
    expect((exportCall?.[1] as { trigger?: string }).trigger).toBe('pipeline-run');

    // The run row carries a success status + a toast confirmed the save.
    expect(useExecutionHistoryStore.getState().entries[0]?.status).toBe('ok');
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('pipeline.capsule.saved');
  });

  it('saves the exact settled run as a capsule even after the input changes', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'json-format' }));
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    useUtilityPipelineStore.getState().setPipelineInput('p1', '{"a":1}');

    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);

    await user.click(screen.getByTestId('utility-pipeline-editor-run'));
    await waitFor(() => {
      const saveBtn = screen.getByTestId('pipeline-save-capsule') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });

    const input = screen.getByTestId('utility-pipeline-editor-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '{"changed":true}' } });
    await user.click(screen.getByTestId('pipeline-save-capsule'));

    const capsule = useExecutionHistoryStore.getState().latestCapsule();
    expect(capsule?.input.stdin).toBe('{"a":1}');
    expect(capsule?.input.stdin).not.toBe('{"changed":true}');
    expect(capsule?.result.stdout).toContain('"a": 1');
  });

  it('shows an error toast and records nothing when the capsule build fails', async () => {
    // Force the pure-crypto capsule build to throw for this one save.
    vi.mocked(buildPipelineCapsule).mockRejectedValueOnce(new Error('crypto unavailable'));

    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'json-format' }));
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    useUtilityPipelineStore.getState().setPipelineInput('p1', '{"a":1}');

    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);

    await user.click(screen.getByTestId('utility-pipeline-editor-run'));
    await waitFor(() => {
      const saveBtn = screen.getByTestId('pipeline-save-capsule') as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });

    await user.click(screen.getByTestId('pipeline-save-capsule'));

    // The failed build surfaces the error toast…
    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'pipeline.capsule.saveFailed'
      );
    });
    // …records NOTHING into the ring (a capsule-less entry would never
    // surface in the Pro browse anyway)…
    expect(useExecutionHistoryStore.getState().latestCapsule()).toBeNull();
    expect(useExecutionHistoryStore.getState().entries).toHaveLength(0);
    // …and never fires the export telemetry.
    const exportCall = mockTrackEvent.mock.calls.find(
      call => call[0] === 'capsule.exported'
    );
    expect(exportCall).toBeUndefined();
  });

  it('disables Save after a successful save so the run cannot be recorded twice', async () => {
    const pipeline = createBlankPipeline({ id: 'p1', name: 'demo' });
    pipeline.steps.push(createBlankStep({ id: 's1', utilityId: 'json-format' }));
    useUtilityPipelineStore.getState().createPipeline(pipeline);
    useUtilityPipelineStore.getState().setPipelineInput('p1', '{"a":1}');

    const user = userEvent.setup();
    render(<UtilityPipelinePanel />);

    await user.click(screen.getByTestId('utility-pipeline-editor-run'));
    await waitFor(() => {
      expect(
        (screen.getByTestId('pipeline-save-capsule') as HTMLButtonElement).disabled
      ).toBe(false);
    });

    await user.click(screen.getByTestId('pipeline-save-capsule'));

    // Exactly one capsule recorded, and the button disables so a re-click
    // cannot append a duplicate of the same run.
    await waitFor(() => {
      expect(useExecutionHistoryStore.getState().entries).toHaveLength(1);
    });
    expect(
      (screen.getByTestId('pipeline-save-capsule') as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
