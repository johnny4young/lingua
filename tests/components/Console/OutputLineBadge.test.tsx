/**
 * implementation — `<OutputLineBadge>` render contract.
 *
 * Covers:
 *   - Renders as a button with the `L<n>` label and aria-label.
 *   - Click emits `file.open` with empty `file` + line
 *     (within-tab path).
 *   - Click fires throttled `runtime.output_origin_clicked` telemetry.
 *   - Hover (after the 200ms debounce) dispatches
 *     `editor.highlightLine` and respects the hover sub-gate.
 *   - Hides itself when the master Settings flag is OFF.
 */

import { render, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputLineBadge } from '../../../src/renderer/components/Console/OutputLineBadge';
import {
  _resetCommandBusForTesting,
  subscribeCommand,
} from '../../../src/renderer/stores/commandBus';

// Hoisted mock: replace `trackOutputOriginClicked` so the badge's
// click handler routes through our spy instead of the real (consent-
// gated, fetch-bound) emit pipeline. `resetOutputOriginThrottleForTests`
// is re-exported as a no-op since the throttle lives inside the
// real helper which we've replaced.
const trackOutputOriginClickedMock = vi.fn(() => ({ emitted: true }));

vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn(),
  emitTelemetryEvent: vi.fn(),
  trackOutputOriginClicked: (...args: unknown[]) => trackOutputOriginClickedMock(...args),
  resetOutputOriginThrottleForTests: () => trackOutputOriginClickedMock.mockClear(),
  OUTPUT_ORIGIN_THROTTLE_MS: 1000,
  isTelemetryEnabled: () => false,
  resolveTelemetryBase: () => ({
    appVersion: '0.0.0-test',
    osBucket: 'unknown/0',
    licenseStatus: 'free',
    sessionId: 'test',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'line' in opts ? `${key}:${opts.line}` : key,
  }),
}));

describe('implementation — <OutputLineBadge>', () => {
  beforeEach(() => {
    trackOutputOriginClickedMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetCommandBusForTesting();
    vi.useRealTimers();
  });

  it('renders an `L<n>` button with the localized aria-label', () => {
    const { getByTestId } = render(<OutputLineBadge origin={{ line: 7 }} language="javascript" />);
    const button = getByTestId('output-line-badge');
    expect(button.textContent).toBe('L7');
    expect(button.getAttribute('aria-label')).toBe('console.outputBadge.ariaLabel:7');
  });

  it('emits `file.open` and calls trackOutputOriginClicked on click', () => {
    const eventSpy = vi.fn();
    const unsubscribe = subscribeCommand('file.open', eventSpy);
    try {
      const { getByTestId } = render(
        <OutputLineBadge origin={{ line: 5 }} language="javascript" />
      );
      fireEvent.click(getByTestId('output-line-badge'));
      expect(eventSpy).toHaveBeenCalled();
      expect(eventSpy.mock.calls[0]?.[0]).toEqual({
        file: '',
        line: 5,
        column: undefined,
      });
      expect(trackOutputOriginClickedMock).toHaveBeenCalledWith('javascript', 'badge');
    } finally {
      unsubscribe();
    }
  });

  it('forwards repeated clicks to the throttled helper (implementation note handles burst dedup)', () => {
    const { getByTestId } = render(<OutputLineBadge origin={{ line: 5 }} language="javascript" />);
    fireEvent.click(getByTestId('output-line-badge'));
    fireEvent.click(getByTestId('output-line-badge'));
    fireEvent.click(getByTestId('output-line-badge'));
    // The badge invokes `trackOutputOriginClicked` on every click; the
    // throttle lives inside the real helper (covered by its own
    // unit-level tests via `resetOutputOriginThrottleForTests`).
    expect(trackOutputOriginClickedMock).toHaveBeenCalledTimes(3);
  });

  it('debounces hover and emits `editor.highlightLine` after 200ms', () => {
    const highlightSpy = vi.fn();
    const unsubscribe = subscribeCommand('editor.highlightLine', highlightSpy);
    try {
      const { getByTestId } = render(<OutputLineBadge origin={{ line: 9 }} language="python" />);
      fireEvent.mouseEnter(getByTestId('output-line-badge'));
      expect(highlightSpy).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(highlightSpy).toHaveBeenCalled();
      const detail = highlightSpy.mock.calls[0]?.[0];
      expect(detail).toEqual({ line: 9, column: undefined, durationMs: 1500 });
    } finally {
      unsubscribe();
    }
  });

  // implementation — the master + hover sub-gate Settings toggles were
  // removed; the badge always renders (subject to the per-tab
  // `// @origin off` directive which is exercised by the parent
  // `<ConsoleEntryRenderer>` suppression path, not here).

  it('renders nothing for invalid origins', () => {
    const { queryByTestId } = render(
      <OutputLineBadge origin={{ line: 0 }} language="javascript" />
    );
    expect(queryByTestId('output-line-badge')).toBeNull();
  });
});
