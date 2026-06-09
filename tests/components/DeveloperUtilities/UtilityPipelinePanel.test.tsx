/**
 * RL-099 Slice 1 — UtilityPipelinePanel tests.
 *
 * Focused on the orchestration the panel owns: create + add step +
 * run + result rendering. Adapter behavior is covered by the unit
 * tests; this suite just verifies the wiring.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { UtilityPipelinePanel } from '../../../src/renderer/components/DeveloperUtilities/UtilityPipelinePanel';
import {
  resetUtilityPipelineStoreForTests,
  useUtilityPipelineStore,
} from '../../../src/renderer/stores/utilityPipelineStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';
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
});
