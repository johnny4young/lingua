/**
 * RL-094 Slice 1.5 — Result-panel header Export button.
 *
 * Covers the load-bearing surfaces:
 *
 *   1. Lazy render to `null` when no capsule has been captured —
 *      the button never advertises a no-op (the user sees nothing
 *      until their first run lands a capsule on the history store).
 *   2. Renders + clicks happy path → clipboard.writeText fires +
 *      `capsule.exported.trigger = 'result-panel-export'` telemetry
 *      fires + status notice pushed.
 *   3. Fold E — exact `sizeBucket` assertion for `FIXTURE_MINIMAL_JS`
 *      so the boundary conditions of the closed enum are pinned.
 *   4. Fold C — Pro badge surfaces ONLY when `richOutputs` is non-
 *      empty (informational nudge, not a gate).
 *   5. Fold D — `data-just-copied="true"` flips on click and resets
 *      after the feedback window so the visual click-confirmation
 *      isn't sticky.
 *   6. Fold F — clipboard-rejected path pushes the
 *      `clipboardUnavailable` notice (points the user to Settings),
 *      NOT the Settings-specific fallback notice.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';

const { mockTrackEvent, mockPushStatusNotice, latestCapsuleRef } = vi.hoisted(
  () => ({
    mockTrackEvent: vi.fn().mockResolvedValue(undefined),
    mockPushStatusNotice: vi.fn(),
    latestCapsuleRef: { current: null as unknown },
  })
);

vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

vi.mock('../../../src/renderer/stores/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (state: { pushStatusNotice: typeof mockPushStatusNotice }) => unknown) =>
      selector({ pushStatusNotice: mockPushStatusNotice }),
    {
      getState: () => ({ pushStatusNotice: mockPushStatusNotice }),
    }
  ),
}));

vi.mock('../../../src/renderer/stores/executionHistoryStore', () => ({
  useExecutionHistoryStore: (selector: (state: {
    latestCapsule: () => unknown;
  }) => unknown) =>
    selector({ latestCapsule: () => latestCapsuleRef.current }),
}));

import { RunCapsuleExportButton } from '../../../src/renderer/components/Editor/RunCapsuleExportButton';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_PYTHON_CHART,
} from '../../shared/runCapsule.fixtures';

describe('RunCapsuleExportButton', () => {
  beforeEach(async () => {
    mockTrackEvent.mockClear();
    mockPushStatusNotice.mockClear();
    latestCapsuleRef.current = null;
    vi.useFakeTimers();
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders null when no capsule has been captured', () => {
    const { container } = render(<RunCapsuleExportButton />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('result-panel-export-capsule')).toBeNull();
  });

  it('renders the button when a capsule is available', () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    render(<RunCapsuleExportButton />);
    const button = screen.getByTestId('result-panel-export-capsule');
    expect(button.getAttribute('aria-label')).toBe('Export run as capsule');
    expect(button.getAttribute('title')).toBe(
      'Export this run as a JSON capsule'
    );
  });

  it('renders neutral Spanish capsule copy', async () => {
    latestCapsuleRef.current = FIXTURE_PYTHON_CHART;
    await i18next.changeLanguage('es');

    render(<RunCapsuleExportButton />);
    const button = screen.getByTestId('result-panel-export-capsule');
    expect(button.getAttribute('aria-label')).toBe(
      'Exporta la ejecución como cápsula'
    );
    expect(button.getAttribute('title')).toBe(
      'Exporta esta ejecución como una cápsula JSON'
    );
    expect(
      screen.getByTestId('result-panel-export-pro-badge').getAttribute('title')
    ).toContain('salidas multimedia enriquecidas');
  });

  it('exports via clipboard happy path and fires telemetry with the exact sizeBucket (fold E)', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsuleExportButton />);
    fireEvent.click(screen.getByTestId('result-panel-export-capsule'));
    await act(async () => {
      // Flush the microtask that resolves the clipboard.writeText
      // promise so the success-notice push lands before assertions.
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const json = writeText.mock.calls[0]![0] as string;
    expect(json).toContain('"version": 1');
    expect(json).toContain(
      '"capsuleId": "00000000-0000-4000-8000-000000000001"'
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('capsule.exported', {
      trigger: 'result-panel-export',
      sizeBucket: '<10kb',
    });
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: 'settings.account.runCapsules.copiedNotice',
      })
    );
  });

  it('flips data-just-copied for the feedback window and resets after (fold D)', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsuleExportButton />);
    const button = screen.getByTestId('result-panel-export-capsule');
    expect(button.getAttribute('data-just-copied')).toBe('false');

    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(button.getAttribute('data-just-copied')).toBe('true');

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(button.getAttribute('data-just-copied')).toBe('false');
  });

  it('resets the feedback timer on a second click within the window (fold D)', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsuleExportButton />);
    const button = screen.getByTestId('result-panel-export-capsule');

    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(button.getAttribute('data-just-copied')).toBe('true');

    // Half the feedback window — flag still on.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(button.getAttribute('data-just-copied')).toBe('true');

    // Second click within the window: timer must reset, flag stays on
    // for ANOTHER full feedback window (not the residual 500 ms).
    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(button.getAttribute('data-just-copied')).toBe('true');

    // Advance past the FIRST timer's window but not the second's — if
    // the timer wasn't reset, the flag would have flipped to false at
    // ~500 ms after the second click (original timer firing). It MUST
    // still be on at 600 ms after the second click.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(button.getAttribute('data-just-copied')).toBe('true');

    // Advance to the second timer's window — now flag flips.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(button.getAttribute('data-just-copied')).toBe('false');
  });

  it('surfaces the Pro badge for capsules with richOutputs (fold C)', () => {
    latestCapsuleRef.current = FIXTURE_PYTHON_CHART;
    render(<RunCapsuleExportButton />);
    expect(
      screen.queryByTestId('result-panel-export-pro-badge')
    ).not.toBeNull();
    const button = screen.getByTestId('result-panel-export-capsule');
    expect(button.getAttribute('data-has-rich-outputs')).toBe('true');
  });

  it('hides the Pro badge for capsules without richOutputs (fold C)', () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    render(<RunCapsuleExportButton />);
    expect(screen.queryByTestId('result-panel-export-pro-badge')).toBeNull();
    const button = screen.getByTestId('result-panel-export-capsule');
    expect(button.getAttribute('data-has-rich-outputs')).toBe('false');
  });

  it('pushes the clipboardUnavailable notice on rejection (fold F)', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsuleExportButton />);
    fireEvent.click(screen.getByTestId('result-panel-export-capsule'));
    // Two microtasks: clipboard.writeText rejects → exportCapsuleToClipboard
    // returns `{ ok: false }` → component pushes notice.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: 'results.actions.exportCapsule.clipboardUnavailable',
      })
    );
    // The button does NOT enter the "just copied" state on rejection.
    const button = screen.getByTestId('result-panel-export-capsule');
    expect(button.getAttribute('data-just-copied')).toBe('false');
  });
});
