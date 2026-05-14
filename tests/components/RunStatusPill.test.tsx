/**
 * RL-020 Slice 7 — RunStatusPill render contract.
 *
 * Covers:
 *   - Hidden on success and when runTermination is null.
 *   - Renders timeout / stopped / error variants with the right
 *     icon + text + tooltip.
 *   - Renders the fold-E countdown variant when showTimeoutCountdown
 *     is on AND runDeadlineAt is set.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunStatusPill } from '../../src/renderer/components/Editor/RunStatusPill';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'runtime.statusPill.timeout.label') return 'Timeout';
      if (key === 'runtime.statusPill.timeout.tooltip')
        return `Run hit the ${opts?.preset} limit (${opts?.seconds}s).`;
      if (key === 'runtime.statusPill.timeout.tooltipOverride')
        return `Run hit the ${opts?.seconds}s limit set for this run.`;
      if (key === 'runtime.statusPill.stopped.label') return 'Stopped';
      if (key === 'runtime.statusPill.stopped.tooltip')
        return 'Run cancelled by you.';
      if (key === 'runtime.statusPill.error.label') return 'Error';
      if (key === 'runtime.statusPill.error.tooltip')
        return 'Run failed. See the message below.';
      if (key === 'runtime.statusPill.countdown.tooltip')
        return `Run in flight. ${opts?.label} until the limit.`;
      if (key === 'runtime.timeout.preset.quick.label') return 'Quick (5s)';
      if (key === 'runtime.timeout.preset.normal.label') return 'Normal (30s)';
      if (key === 'runtime.timeout.preset.long.label') return 'Long (2min)';
      if (key === 'runtime.timeout.preset.extended.label')
        return 'Extended (5min)';
      return key;
    },
  }),
}));

function selectPill(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-result-kind="run-status-pill"]'
  );
}

describe('RL-020 Slice 7 — <RunStatusPill>', () => {
  beforeEach(() => {
    useResultStore.setState({
      runTermination: null,
      runDeadlineAt: null,
    });
    useSettingsStore.setState({ showTimeoutCountdown: false });
  });

  it('renders nothing when runTermination is null', () => {
    render(<RunStatusPill />);
    expect(selectPill()).toBeNull();
  });

  it('renders nothing on success', () => {
    useResultStore.setState({
      runTermination: { kind: 'success' },
    });
    render(<RunStatusPill />);
    expect(selectPill()).toBeNull();
  });

  it('renders the timeout variant with preset + seconds in the tooltip', () => {
    useResultStore.setState({
      runTermination: {
        kind: 'timeout',
        timeoutPreset: 'quick',
        timeoutMs: 5_000,
      },
    });
    render(<RunStatusPill />);
    const pill = selectPill();
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute('data-run-status')).toBe('timeout');
    expect(pill?.getAttribute('title')).toBe(
      'Run hit the Quick (5s) limit (5s).'
    );
    expect(pill?.textContent).toContain('Timeout');
  });

  it('uses the override tooltip when the preset is "override"', () => {
    useResultStore.setState({
      runTermination: {
        kind: 'timeout',
        timeoutPreset: 'override',
        timeoutMs: 90_000,
      },
    });
    render(<RunStatusPill />);
    expect(selectPill()?.getAttribute('title')).toBe(
      'Run hit the 90s limit set for this run.'
    );
  });

  it('renders the stopped variant', () => {
    useResultStore.setState({
      runTermination: { kind: 'stopped' },
    });
    render(<RunStatusPill />);
    const pill = selectPill();
    expect(pill?.getAttribute('data-run-status')).toBe('stopped');
    expect(pill?.textContent).toContain('Stopped');
  });

  it('renders the error variant', () => {
    useResultStore.setState({
      runTermination: { kind: 'error' },
    });
    render(<RunStatusPill />);
    const pill = selectPill();
    expect(pill?.getAttribute('data-run-status')).toBe('error');
    expect(pill?.textContent).toContain('Error');
  });

  it('countdown variant wins when showTimeoutCountdown is on + deadline set', () => {
    useSettingsStore.setState({ showTimeoutCountdown: true });
    const deadline = Date.now() + 65_000;
    useResultStore.setState({
      runTermination: { kind: 'error' },
      runDeadlineAt: deadline,
    });
    render(<RunStatusPill />);
    const pill = selectPill();
    expect(pill?.getAttribute('data-run-status')).toBe('countdown');
    expect(pill?.textContent).toMatch(/\d+:\d{2}/);
  });
});
