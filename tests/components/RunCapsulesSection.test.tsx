/**
 * implementation — Settings → Account → Run Capsules surface test.
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
import { subscribeCommand } from '../../src/renderer/stores/commandBus';

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

// internal — the HTML export orchestration is covered by its own unit
// suite (`tests/utils/exportCapsuleHtml.test.ts`); here we only assert
// the surface wires the right capsule + trigger + outcome notices.
const { mockExportCapsuleAsHtml } = vi.hoisted(() => ({
  mockExportCapsuleAsHtml: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/renderer/utils/exportCapsuleHtml', () => ({
  exportCapsuleAsHtml: mockExportCapsuleAsHtml,
}));

const { latestCapsuleRef } = vi.hoisted(() => ({
  latestCapsuleRef: { current: null as unknown },
}));

vi.mock('../../src/renderer/stores/executionHistoryStore', () => ({
  useExecutionHistoryStore: (selector: (state: { latestCapsule: () => unknown }) => unknown) =>
    selector({ latestCapsule: () => latestCapsuleRef.current }),
}));

import { RunCapsulesSection } from '../../src/renderer/components/Settings/RunCapsulesSection';
import { FIXTURE_MINIMAL_JS, FIXTURE_LARGE_STDOUT } from '../shared/runCapsule.fixtures';

describe('RunCapsulesSection', () => {
  beforeEach(async () => {
    mockTrackEvent.mockClear();
    mockPushStatusNotice.mockClear();
    mockExportCapsuleAsHtml.mockReset().mockResolvedValue(undefined);
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
    const htmlButton = screen.getByTestId('capsule-export-html-button') as HTMLButtonElement;
    expect(htmlButton.disabled).toBe(true);
    expect(htmlButton.className).toContain('focus-ring');
    expect(
      screen.queryByText('Run any code first; the latest result becomes exportable here.')
    ).not.toBeNull();
  });

  it('emits capsule.openList with the settings surface when Browse is clicked ', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommand('capsule.openList', listener);
    try {
      render(<RunCapsulesSection />);
      fireEvent.click(screen.getByTestId('capsule-browse-button'));
      expect(listener).toHaveBeenCalledWith({ surface: 'settings' }, expect.any(Object));
    } finally {
      unsubscribe();
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
    await new Promise(resolve => setTimeout(resolve, 0));

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

  it('exports the latest capsule as HTML with the settings trigger', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    mockExportCapsuleAsHtml.mockImplementation(
      async (_capsule, _trigger, context: { onOk: () => void }) => {
        context.onOk();
      }
    );

    render(<RunCapsulesSection />);
    const button = screen.getByTestId('capsule-export-html-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockExportCapsuleAsHtml).toHaveBeenCalledTimes(1);
    expect(mockExportCapsuleAsHtml).toHaveBeenCalledWith(
      FIXTURE_MINIMAL_JS,
      'settings-export-html',
      expect.objectContaining({ locale: 'en' })
    );
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'capsuleHtml.notice.saved' })
    );
  });

  it('surfaces the error notice when the HTML export fails', async () => {
    latestCapsuleRef.current = FIXTURE_MINIMAL_JS;
    mockExportCapsuleAsHtml.mockImplementation(
      async (_capsule, _trigger, context: { onError: () => void }) => {
        context.onError();
      }
    );

    render(<RunCapsulesSection />);
    fireEvent.click(screen.getByTestId('capsule-export-html-button'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'capsuleHtml.notice.failed' })
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
    await new Promise(resolve => setTimeout(resolve, 0));
    const pretty = writeText.mock.calls[0]![0] as string;
    expect(pretty).toContain('\n');

    // Flip the toggle off — second export should be minified.
    const toggle = screen.getByTestId('capsule-pretty-toggle');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('capsule-export-button'));
    await new Promise(resolve => setTimeout(resolve, 0));
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
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'capsule.exported',
      expect.objectContaining({ sizeBucket: expect.any(String) })
    );
    const callArgs = mockTrackEvent.mock.calls[0]![1] as { sizeBucket: string };
    expect(['<1mb', '<4mb']).toContain(callArgs.sizeBucket);
  });
});
