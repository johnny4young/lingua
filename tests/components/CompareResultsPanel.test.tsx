/**
 * RL-020 Slice 8 — CompareResultsPanel render contract.
 *
 * Covers:
 *   - "No snapshot" empty state when the ring is empty for the
 *     requested language.
 *   - Dynamic-mode three-column diff renders rows for added /
 *     removed / changed.
 *   - "Identical" empty state when current matches snapshot.
 *   - Compiled-mode unified diff renders +/- prefixes.
 *   - Ring dropdown renders when ≥2 snapshots match the language.
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompareResultsPanel } from '../../src/renderer/components/Editor/CompareResultsPanel';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import type { ResultSnapshot } from '../../src/renderer/stores/resultStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && (opts.time || opts.ordinal)) {
        return `${key}::${JSON.stringify(opts)}`;
      }
      return key;
    },
  }),
}));

function makeSnapshot(partial: Partial<ResultSnapshot>): ResultSnapshot {
  return {
    lineResults: [],
    fullOutput: '',
    stdinConsumed: null,
    executionTime: 12,
    language: 'javascript',
    capturedAt: 1_000,
    ...partial,
  };
}

describe('RL-020 Slice 8 — <CompareResultsPanel>', () => {
  beforeEach(() => {
    useResultStore.setState({
      snapshotRing: [],
      selectedCompareTargetCapturedAt: null,
      lineResults: [],
      fullOutput: '',
    });
  });

  it('renders the no-snapshot empty state when the ring has no language match', () => {
    useResultStore.setState({
      snapshotRing: [makeSnapshot({ language: 'python' })],
      lineResults: [],
      fullOutput: '',
    });
    const { container } = render(<CompareResultsPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="compare-empty-no-snapshot"]')
    ).not.toBeNull();
  });

  it('renders three-column diff rows for changed dynamic results', () => {
    useResultStore.setState({
      snapshotRing: [
        makeSnapshot({
          lineResults: [{ line: 1, value: '2', type: 'result' }],
        }),
      ],
      lineResults: [{ line: 1, value: '4', type: 'result' }],
      fullOutput: '',
    });
    const { container } = render(<CompareResultsPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="compare-row-changed"]')
    ).not.toBeNull();
  });

  it('defaults to the previous stable target when newest snapshot matches current', () => {
    useResultStore.setState({
      snapshotRing: [
        makeSnapshot({
          capturedAt: 1_000,
          lineResults: [{ line: 1, value: '2', type: 'result' }],
        }),
        makeSnapshot({
          capturedAt: 2_000,
          lineResults: [{ line: 1, value: '4', type: 'result' }],
        }),
      ],
      lineResults: [{ line: 1, value: '4', type: 'result' }],
      fullOutput: '',
    });
    const { container } = render(<CompareResultsPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="compare-row-changed"]')
    ).not.toBeNull();
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('4');
  });

  it('honors an explicitly selected newest target', () => {
    useResultStore.setState({
      snapshotRing: [
        makeSnapshot({
          capturedAt: 1_000,
          lineResults: [{ line: 1, value: '2', type: 'result' }],
        }),
        makeSnapshot({
          capturedAt: 2_000,
          lineResults: [{ line: 1, value: '4', type: 'result' }],
        }),
      ],
      selectedCompareTargetCapturedAt: 2_000,
      lineResults: [{ line: 1, value: '4', type: 'result' }],
      fullOutput: '',
    });
    const { container } = render(<CompareResultsPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="compare-empty-identical"]')
    ).not.toBeNull();
  });

  it('renders the identical empty state when current matches snapshot', () => {
    useResultStore.setState({
      snapshotRing: [
        makeSnapshot({
          lineResults: [{ line: 1, value: '2', type: 'result' }],
        }),
      ],
      lineResults: [{ line: 1, value: '2', type: 'result' }],
      fullOutput: '',
    });
    const { container } = render(<CompareResultsPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="compare-empty-identical"]')
    ).not.toBeNull();
  });

  it('renders unified diff segments for compiled-mode runs', () => {
    useResultStore.setState({
      snapshotRing: [
        makeSnapshot({ language: 'go', fullOutput: 'hello' }),
      ],
      lineResults: [],
      fullOutput: 'world',
    });
    const { container } = render(<CompareResultsPanel language="go" />);
    expect(
      container.querySelector('[data-testid="compare-unified"]')
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="compare-segment-add"]').length
    ).toBeGreaterThan(0);
  });

  it('shows the ring dropdown when ≥2 snapshots match the language', () => {
    useResultStore.setState({
      snapshotRing: [
        makeSnapshot({ capturedAt: 1_000 }),
        makeSnapshot({ capturedAt: 2_000 }),
      ],
      lineResults: [],
      fullOutput: '',
    });
    const { container } = render(<CompareResultsPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="compare-target-select"]')
    ).not.toBeNull();
  });

  it('hides the ring dropdown when only one snapshot exists', () => {
    useResultStore.setState({
      snapshotRing: [makeSnapshot({})],
      lineResults: [],
      fullOutput: '',
    });
    const { container } = render(<CompareResultsPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="compare-target-select"]')
    ).toBeNull();
  });
});
