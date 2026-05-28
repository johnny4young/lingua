/**
 * RL-094 Slice 1 — Settings → Account → Run Capsules surface test.
 *
 * Covers the four user-facing flows of `RunCapsulesSection`:
 *
 *   1. Empty state — no captured capsule, button disabled, copy
 *      `emptyState` visible.
 *   2. Happy path — clicking Export serialises the latest capsule,
 *      writes to clipboard, fires `capsule.exported` telemetry, and
 *      pushes a `copiedNotice` status.
 *   3. Fallback path — clipboard.writeText throws (Safari private
 *      mode); the textarea fallback appears with the JSON content
 *      and the fallback notice is pushed.
 *   4. Pretty-print toggle — flipping the checkbox switches the
 *      serialised output between indented and minified.
 *
 * Telemetry is verified via a fixture-mocked `trackEvent` (matches
 * the pattern in `tests/runtime/executeTabManually.telemetry.test.ts`).
 */

import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';

const { mockTrackEvent, mockPushStatusNotice } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
  mockPushStatusNotice: vi.fn(),
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (state: { pushStatusNotice: typeof mockPushStatusNotice }) => unknown) =>
      selector({ pushStatusNotice: mockPushStatusNotice }),
    {
      getState: () => ({ pushStatusNotice: mockPushStatusNotice }),
    }
  ),
}));

const { latestCapsuleRef } = vi.hoisted(() => ({
  latestCapsuleRef: { current: null as unknown },
}));

vi.mock('../../src/renderer/stores/executionHistoryStore', () => ({
  useExecutionHistoryStore: (selector: (state: {
    latestCapsule: () => unknown;
  }) => unknown) =>
    selector({ latestCapsule: () => latestCapsuleRef.current }),
}));

import { RunCapsulesSection } from '../../src/renderer/components/Settings/RunCapsulesSection';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_LARGE_STDOUT,
} from '../shared/runCapsule.fixtures';

describe('RunCapsulesSection', () => {
  beforeEach(async () => {
    mockTrackEvent.mockClear();
    mockPushStatusNotice.mockClear();
    latestCapsuleRef.current = null;
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the empty state when no capsule has been captured', () => {
    render(<RunCapsulesSection />);
    const button = screen.getByTestId('capsule-export-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(
      screen.queryByText(
        'Run any code first; the latest result becomes exportable here.'
      )
    ).not.toBeNull();
  });

  it('dispatches lingua-open-capsule-list with the settings surface when Browse is clicked (RL-094 Slice 3)', () => {
    const events: CustomEvent[] = [];
    const handler = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('lingua-open-capsule-list', handler);
    try {
      render(<RunCapsulesSection />);
      fireEvent.click(screen.getByTestId('capsule-browse-button'));
      expect(events).toHaveLength(1);
      expect((events[0]!.detail as { surface?: string }).surface).toBe(
        'settings'
      );
    } finally {
      window.removeEventListener('lingua-open-capsule-list', handler);
    }
  });

  it('exports the latest capsule via the clipboard happy path', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsulesSection />);
    const button = screen.getByTestId('capsule-export-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    // Async handler — wait one microtask flush so writeText resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).toHaveBeenCalledTimes(1);
    const json = writeText.mock.calls[0]![0] as string;
    expect(json).toContain('"version": 1');
    expect(json).toContain('"capsuleId": "00000000-0000-4000-8000-000000000001"');

    expect(mockTrackEvent).toHaveBeenCalledWith('capsule.exported', {
      trigger: 'settings-export',
      sizeBucket: '<10kb',
    });
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: 'settings.account.runCapsules.copiedNotice',
      })
    );
  });

  it('falls back to the inline textarea when clipboard rejects', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsulesSection />);
    fireEvent.click(screen.getByTestId('capsule-export-button'));

    const textarea = (await screen.findByTestId(
      'capsule-fallback-textarea'
    )) as HTMLTextAreaElement;
    expect(textarea.value).toContain('"version": 1');
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: 'settings.account.runCapsules.fallbackNotice',
      })
    );
  });

  it('flips between pretty-printed and minified output via the toggle', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsulesSection />);

    // Pretty-print is on by default — first export should include
    // indentation (newline characters).
    fireEvent.click(screen.getByTestId('capsule-export-button'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pretty = writeText.mock.calls[0]![0] as string;
    expect(pretty).toContain('\n');

    // Flip the toggle off — second export should be minified.
    const toggle = screen.getByTestId('capsule-pretty-toggle');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('capsule-export-button'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const minified = writeText.mock.calls[1]![0] as string;
    expect(minified).not.toContain('\n');
    expect(minified.length).toBeLessThan(pretty.length);
  });

  it('reports the right sizeBucket telemetry for an oversized capsule', async () => {
    // FIXTURE_LARGE_STDOUT carries 1.2M of stdout; the SETTINGS export
    // path sanitises first → stdout truncated to MAX_STREAM_BYTES,
    // serialised JSON sits around 1MB → sizeBucket `<4mb`.
    latestCapsuleRef.current = FIXTURE_LARGE_STDOUT;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<RunCapsulesSection />);
    fireEvent.click(screen.getByTestId('capsule-export-button'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'capsule.exported',
      expect.objectContaining({ sizeBucket: expect.any(String) })
    );
    const callArgs = mockTrackEvent.mock.calls[0]![1] as { sizeBucket: string };
    expect(['<1mb', '<4mb']).toContain(callArgs.sizeBucket);
  });
});
