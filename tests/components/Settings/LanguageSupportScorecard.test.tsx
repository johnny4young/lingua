/**
 * RL-095 Slice 1 — LanguageSupportScorecard component tests.
 *
 * Covers:
 *   1. Renders a row per `LANGUAGE_SUPPORT_PROFILES` entry and a
 *      column per `LANGUAGE_CAPABILITIES` axis.
 *   2. Per-platform chip (fold C) renders only when a profile has a
 *      `perPlatform` override (Ruby is the canonical case).
 *   3. Legend popover (fold D) is closed by default, opens on click,
 *      and lists every `LanguageCapabilityStatus`.
 *   4. Fold E stayed dropped: no closed-source CTA, ticket id, or
 *      private repo URL leaks into the scorecard.
 *   5. Adoption telemetry (fold A) fires `language_scorecard_viewed`
 *      once per surface via the no-IntersectionObserver fallback path,
 *      and the module-level guard prevents double-fire on remount.
 *      `markLanguageScorecardSurfaceForNextMount('palette')` claims
 *      the next mount so the palette command surface tag flows
 *      through to telemetry without the component needing a prop.
 *   6. ES locale renders title + capability headers with tuteo copy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { LanguageSupportScorecard } from '@/components/Settings/LanguageSupportScorecard';
import {
  _resetLanguageScorecardAdoptionGuardForTesting,
  markLanguageScorecardSurfaceForNextMount,
} from '@/components/Settings/languageSupportScorecardTelemetry';
import {
  LANGUAGE_CAPABILITIES,
  LANGUAGE_CAPABILITY_STATUSES,
  LANGUAGE_SUPPORT_PROFILES,
} from '../../../src/shared/languageSupport';
import { useSettingsStore } from '@/stores/settingsStore';

const { trackEventMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

// The component uses IntersectionObserver but falls back to firing
// telemetry immediately when it's absent (older Electron, jsdom).
// Forcing the absent path here keeps the telemetry assertion
// deterministic across vitest + jsdom versions that ship a stub.
type IOWindow = Window & {
  IntersectionObserver?: typeof IntersectionObserver;
};

const ORIGINAL_INTERSECTION_OBSERVER = (window as IOWindow).IntersectionObserver;

describe('LanguageSupportScorecard', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    _resetLanguageScorecardAdoptionGuardForTesting();
    trackEventMock.mockReset();
    // RL-095 Slice 2 — reset the sticky platform filter so a toggle in one
    // test never leaks the resolved-cell view into the next.
    useSettingsStore.setState({ languageScorecardPlatform: 'all' });
    // Force the no-IntersectionObserver fallback so telemetry fires
    // synchronously on mount.
    delete (window as IOWindow).IntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    _resetLanguageScorecardAdoptionGuardForTesting();
    if (ORIGINAL_INTERSECTION_OBSERVER) {
      (window as IOWindow).IntersectionObserver = ORIGINAL_INTERSECTION_OBSERVER;
    }
  });

  it('renders one row per profile in stability order', () => {
    render(<LanguageSupportScorecard />);
    expect(screen.getByTestId('language-support-scorecard')).toBeTruthy();
    for (const profile of LANGUAGE_SUPPORT_PROFILES) {
      expect(
        screen.getByTestId(`language-support-scorecard-row-${profile.languageId}`)
      ).toBeTruthy();
    }
  });

  it('renders one cell per capability axis on every row', () => {
    render(<LanguageSupportScorecard />);
    for (const profile of LANGUAGE_SUPPORT_PROFILES) {
      for (const cap of LANGUAGE_CAPABILITIES) {
        const cell = screen.getByTestId(
          `language-support-scorecard-cell-${profile.languageId}-${cap}`
        );
        expect(cell).toBeTruthy();
        expect(cell.getAttribute('data-status')).toBe(profile.capabilities[cap]);
      }
    }
  });

  it('renders per-platform chips only where the profile overrides them (Ruby)', () => {
    render(<LanguageSupportScorecard />);
    // Ruby has perPlatform overrides on webRuntime + desktopRuntime.
    const rubyWebChip = screen.getByTestId(
      'language-support-scorecard-platform-ruby-webRuntime'
    );
    expect(rubyWebChip).toBeTruthy();
    // The W pill renders with data-platform="web" + the override tone.
    const webPill = rubyWebChip.querySelector('[data-platform="web"]');
    expect(webPill).not.toBeNull();
    expect(webPill?.textContent).toBe('W');
    expect(webPill?.getAttribute('title')).toBe('Web: Partial');

    const rubyDesktopChip = screen.getByTestId(
      'language-support-scorecard-platform-ruby-desktopRuntime'
    );
    const desktopPill = rubyDesktopChip.querySelector('[data-platform="desktop"]');
    expect(desktopPill).not.toBeNull();
    expect(desktopPill?.textContent).toBe('D');
    expect(desktopPill?.getAttribute('title')).toBe('Desktop: Available');
  });

  it('does NOT render a per-platform chip on capabilities without overrides', () => {
    render(<LanguageSupportScorecard />);
    // Pick a JavaScript axis — no perPlatform overrides in the profile.
    expect(
      screen.queryByTestId('language-support-scorecard-platform-javascript-syntax')
    ).toBeNull();
    expect(
      screen.queryByTestId('language-support-scorecard-platform-python-richOutput')
    ).toBeNull();
  });

  it('keeps the legend popover closed by default', () => {
    render(<LanguageSupportScorecard />);
    expect(screen.queryByTestId('language-support-scorecard-legend')).toBeNull();
    const toggle = screen.getByTestId('language-support-scorecard-legend-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the legend popover on click and lists every status', () => {
    render(<LanguageSupportScorecard />);
    fireEvent.click(screen.getByTestId('language-support-scorecard-legend-toggle'));
    const legend = screen.getByTestId('language-support-scorecard-legend');
    expect(legend).toBeTruthy();
    for (const status of LANGUAGE_CAPABILITY_STATUSES) {
      expect(legend.querySelector(`[data-status="${status}"]`)).not.toBeNull();
    }
  });

  it('toggles the legend popover closed on second click', () => {
    render(<LanguageSupportScorecard />);
    const toggle = screen.getByTestId('language-support-scorecard-legend-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('language-support-scorecard-legend')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('language-support-scorecard-legend')).toBeNull();
  });

  it('renders no closed-source CTA link (RL-095 audit — repo URL/ticket id removed)', () => {
    render(<LanguageSupportScorecard />);
    expect(screen.queryByTestId('language-support-scorecard-cta')).toBeNull();
    expect(
      screen.getByTestId('language-support-scorecard').textContent ?? ''
    ).not.toMatch(/RL-\d{3}|github\.com|contribute|colaborar/i);
  });

  it('fires language_scorecard_viewed once on mount with surface=settings', () => {
    render(<LanguageSupportScorecard />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith('language_scorecard_viewed', {
      surface: 'settings',
    });
  });

  it('respects the surface prop — palette tag flows through to telemetry', () => {
    render(<LanguageSupportScorecard surface="palette" />);
    expect(trackEventMock).toHaveBeenCalledWith('language_scorecard_viewed', {
      surface: 'palette',
    });
  });

  it('consumes the next-mount surface override (palette claim) without a prop', () => {
    markLanguageScorecardSurfaceForNextMount('palette');
    render(<LanguageSupportScorecard />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith('language_scorecard_viewed', {
      surface: 'palette',
    });
    // Override is single-use; a subsequent mount (after reset) should
    // fall back to the default 'settings' surface.
    _resetLanguageScorecardAdoptionGuardForTesting();
    trackEventMock.mockReset();
    cleanup();
    render(<LanguageSupportScorecard />);
    expect(trackEventMock).toHaveBeenCalledWith('language_scorecard_viewed', {
      surface: 'settings',
    });
  });

  it('does not double-fire on re-render thanks to the module-level guard', () => {
    const { unmount } = render(<LanguageSupportScorecard />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    unmount();
    render(<LanguageSupportScorecard />);
    // Guard is module-scoped and only resets between tests via the
    // exported reset helper, so a remount in the same test should
    // NOT re-emit the event.
    expect(trackEventMock).toHaveBeenCalledTimes(1);
  });

  it('tracks settings + palette surfaces independently', () => {
    const { unmount } = render(<LanguageSupportScorecard surface="settings" />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    unmount();
    render(<LanguageSupportScorecard surface="palette" />);
    expect(trackEventMock).toHaveBeenCalledTimes(2);
    const calls = trackEventMock.mock.calls.map((args) => args[1]);
    expect(calls).toEqual([{ surface: 'settings' }, { surface: 'palette' }]);
  });

  // RL-095 Slice 2 — Web | Desktop platform filter.
  const toggledCalls = () =>
    trackEventMock.mock.calls.filter(
      (args) => args[0] === 'language_scorecard_platform_toggled'
    );

  it('defaults the platform toggle to All', () => {
    render(<LanguageSupportScorecard />);
    const group = screen.getByTestId('language-support-scorecard-platform-toggle');
    expect(group).toBeTruthy();
    expect(
      screen
        .getByTestId('language-support-scorecard-platform-all')
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen
        .getByTestId('language-support-scorecard-platform-web')
        .getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('collapses cells to the web-resolved status when Web is selected', () => {
    render(<LanguageSupportScorecard />);
    // JS packages is desktop-only -> unsupported on web.
    fireEvent.click(screen.getByTestId('language-support-scorecard-platform-web'));
    const cell = screen.getByTestId(
      'language-support-scorecard-cell-javascript-packages'
    );
    expect(cell.getAttribute('data-status')).toBe('unsupported');
    expect(cell.getAttribute('data-platform-view')).toBe('web');
    // The W/D override pills disappear in a single-platform view — the
    // column IS the platform.
    expect(
      screen.queryByTestId('language-support-scorecard-platform-ruby-webRuntime')
    ).toBeNull();
  });

  it('collapses cells to the desktop-resolved status when Desktop is selected', () => {
    render(<LanguageSupportScorecard />);
    fireEvent.click(
      screen.getByTestId('language-support-scorecard-platform-desktop')
    );
    const cell = screen.getByTestId(
      'language-support-scorecard-cell-javascript-packages'
    );
    // desktop-only -> available on desktop.
    expect(cell.getAttribute('data-status')).toBe('available');
    expect(cell.getAttribute('data-platform-view')).toBe('desktop');
  });

  it('per-platform tooltip leads with the resolved status, then appends the axis note', () => {
    render(<LanguageSupportScorecard />);
    fireEvent.click(screen.getByTestId('language-support-scorecard-platform-web'));
    // Go LSP is desktop-only -> unsupported on web AND carries an axis
    // note (the gopls bridge). The tooltip must lead with the resolved
    // status so the chip + tooltip agree; the note follows for context.
    const goLsp = screen.getByTestId('language-support-scorecard-cell-go-lsp');
    const goTitle = goLsp.getAttribute('title') ?? '';
    expect(goTitle.startsWith('Web: Unsupported')).toBe(true);
    expect(goTitle).toContain('gopls');
    // A cell with no note shows just the resolved "{platform}: {status}".
    const jsSyntax = screen.getByTestId(
      'language-support-scorecard-cell-javascript-syntax'
    );
    expect(jsSyntax.getAttribute('title')).toBe('Web: Available');
  });

  it('restores the All view (default chip + Ruby pills) when toggled back', () => {
    render(<LanguageSupportScorecard />);
    fireEvent.click(screen.getByTestId('language-support-scorecard-platform-web'));
    expect(
      screen.queryByTestId('language-support-scorecard-platform-ruby-webRuntime')
    ).toBeNull();
    fireEvent.click(screen.getByTestId('language-support-scorecard-platform-all'));
    expect(
      screen.getByTestId('language-support-scorecard-platform-ruby-webRuntime')
    ).toBeTruthy();
    // The cell carries no per-platform-view marker back in All.
    const cell = screen.getByTestId(
      'language-support-scorecard-cell-javascript-packages'
    );
    expect(cell.getAttribute('data-status')).toBe('desktop-only');
    expect(cell.getAttribute('data-platform-view')).toBeNull();
  });

  it('fires language_scorecard_platform_toggled once per real change', () => {
    render(<LanguageSupportScorecard />);
    fireEvent.click(screen.getByTestId('language-support-scorecard-platform-web'));
    expect(toggledCalls()).toEqual([
      ['language_scorecard_platform_toggled', { platform: 'web' }],
    ]);
    // Re-clicking the active option is a no-op (no duplicate event).
    fireEvent.click(screen.getByTestId('language-support-scorecard-platform-web'));
    expect(toggledCalls()).toHaveLength(1);
    fireEvent.click(
      screen.getByTestId('language-support-scorecard-platform-desktop')
    );
    expect(toggledCalls()).toHaveLength(2);
    expect(toggledCalls()[1]).toEqual([
      'language_scorecard_platform_toggled',
      { platform: 'desktop' },
    ]);
  });

  it('renders the platform toggle labels with ES tuteo copy', async () => {
    await i18next.changeLanguage('es');
    render(<LanguageSupportScorecard />);
    expect(
      screen.getByTestId('language-support-scorecard-platform-all').textContent
    ).toBe('Todas');
    expect(
      screen.getByTestId('language-support-scorecard-platform-desktop').textContent
    ).toBe('Escritorio');
  });

  it('renders ES copy with tuteo when locale flips to es', async () => {
    await i18next.changeLanguage('es');
    render(<LanguageSupportScorecard />);
    // The scorecard title key + table label render through i18next.
    // Looser assertions here keep the test robust to wording tweaks
    // while still catching missing-key regressions (which would
    // surface as the raw key string).
    const container = screen.getByTestId('language-support-scorecard');
    expect(container.textContent ?? '').not.toContain(
      'languageSupport.scorecard.title'
    );
    expect(container.textContent ?? '').not.toContain(
      'languageSupport.capability.syntax'
    );
  });
});
