import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyTrustSection } from '@/components/Settings/PrivacyTrustSection';
import {
  _resetPrivacyDashboardTelemetryForTesting,
  markPrivacyDashboardSurfaceForNextMount,
} from '@/components/Settings/privacyTrustTelemetry';
import {
  TRUST_EVENT_STORAGE_KEY,
  _resetTrustEventCounterForTesting,
  useTrustEventStore,
} from '@/stores/trustEventStore';
import { useUIStore } from '@/stores/uiStore';

const { trackEventMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

const initialUIState = useUIStore.getState();

describe('PrivacyTrustSection', () => {
  const pushStatusNoticeMock = vi.fn();

  beforeEach(async () => {
    await i18next.changeLanguage('en');
    cleanup();
    window.localStorage.clear();
    _resetPrivacyDashboardTelemetryForTesting();
    _resetTrustEventCounterForTesting();
    useTrustEventStore.getState().clear();
    useUIStore.setState(initialUIState, true);
    useUIStore.setState({ pushStatusNotice: pushStatusNoticeMock });
    trackEventMock.mockReset();
    pushStatusNoticeMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    _resetPrivacyDashboardTelemetryForTesting();
  });

  it('renders the redaction preview and only audited persisted local stores', () => {
    window.localStorage.setItem('lingua-snippets', 'abc');
    render(<PrivacyTrustSection />);

    expect(
      screen.getByRole('heading', { name: 'Redaction preview' })
    ).toBeTruthy();
    expect(
      screen.queryByTestId('privacy-local-stores-row-lingua-execution-history')
    ).toBeNull();
    expect(
      screen.getByTestId('privacy-local-stores-row-lingua-snippets')
    ).toBeTruthy();

    fireEvent.change(screen.getByTestId('privacy-redaction-input'), {
      target: { value: '{"token":"abc","language":"python"}' },
    });
    expect(screen.getByTestId('privacy-redaction-after').textContent).toContain(
      '"token": "<redacted>"'
    );
    expect(screen.getByTestId('privacy-redaction-after').textContent).toContain(
      '"language": "python"'
    );
  });

  it('fires settings-surface telemetry once from the mounted panel', () => {
    const first = render(<PrivacyTrustSection />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith('privacy.dashboard_opened', {
      surface: 'settings',
    });

    first.unmount();
    render(<PrivacyTrustSection />);
    expect(trackEventMock).toHaveBeenCalledTimes(1);
  });

  it('consumes the palette surface claim for the next mount', () => {
    markPrivacyDashboardSurfaceForNextMount('palette');
    render(<PrivacyTrustSection />);

    expect(
      screen.getByTestId('privacy-trust-section').getAttribute('data-surface')
    ).toBe('palette');
    expect(trackEventMock).toHaveBeenCalledWith('privacy.dashboard_opened', {
      surface: 'palette',
    });
  });

  it('clears the trust-event store and removes its persisted key through confirmation', async () => {
    useTrustEventStore.getState().record({
      feature: 'telemetry',
      action: 'enqueue',
      sensitivity: 'low',
      summary: 'recorded locally',
    });
    expect(window.localStorage.getItem(TRUST_EVENT_STORAGE_KEY)).not.toBeNull();

    render(<PrivacyTrustSection />);
    fireEvent.click(
      screen.getByTestId(`privacy-local-stores-clear-${TRUST_EVENT_STORAGE_KEY}`)
    );
    expect(screen.getByTestId('privacy-clear-confirm-modal')).toBeTruthy();

    fireEvent.click(screen.getByTestId('privacy-clear-confirm-confirm'));
    await waitFor(() =>
      expect(window.localStorage.getItem(TRUST_EVENT_STORAGE_KEY)).toBeNull()
    );
    expect(useTrustEventStore.getState().events).toEqual([]);
    expect(pushStatusNoticeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: 'settings.privacy.localStores.cleared',
        values: { key: TRUST_EVENT_STORAGE_KEY },
      })
    );
  });

  // RL-096 Slice 2 — Recent activity feed + live Network last-call.
  it('shows the empty state when no trust events are captured', () => {
    render(<PrivacyTrustSection />);
    expect(screen.getByTestId('privacy-recent-empty')).toBeTruthy();
    expect(screen.queryByTestId('privacy-recent-list')).toBeNull();
  });

  it('renders captured events newest-first in the Recent activity feed', () => {
    const record = useTrustEventStore.getState().record;
    record({
      feature: 'capsule-export',
      action: 'exported',
      sensitivity: 'medium',
      summary: 'JavaScript capsule exported (small)',
    });
    record({
      feature: 'share-link',
      action: 'created',
      sensitivity: 'medium',
      summary: 'Share link created (button, small)',
    });
    render(<PrivacyTrustSection />);
    const list = screen.getByTestId('privacy-recent-list');
    const rows = list.querySelectorAll('[data-testid^="privacy-recent-row-"]');
    expect(rows).toHaveLength(2);
    // Newest (share-link) first.
    expect(rows[0]!.getAttribute('data-feature')).toBe('share-link');
    expect(rows[1]!.getAttribute('data-feature')).toBe('capsule-export');
  });

  it('filters the feed by sensitivity (fold E)', () => {
    const record = useTrustEventStore.getState().record;
    record({ feature: 'telemetry', action: 'event_sent', sensitivity: 'low', summary: 'a' });
    record({ feature: 'capsule-export', action: 'exported', sensitivity: 'medium', summary: 'b' });
    render(<PrivacyTrustSection />);
    expect(
      screen.getByTestId('privacy-recent-list').querySelectorAll(
        '[data-testid^="privacy-recent-row-"]'
      )
    ).toHaveLength(2);

    fireEvent.click(screen.getByTestId('privacy-recent-filter-medium'));
    const rows = screen
      .getByTestId('privacy-recent-list')
      .querySelectorAll('[data-testid^="privacy-recent-row-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-sensitivity')).toBe('medium');

    // Filtering to a sensitivity with no events shows the empty state.
    fireEvent.click(screen.getByTestId('privacy-recent-filter-high'));
    expect(screen.getByTestId('privacy-recent-empty')).toBeTruthy();
  });

  it('derives the Network table last-call from the trust log', () => {
    useTrustEventStore.getState().record({
      feature: 'capsule-export',
      action: 'exported',
      sensitivity: 'medium',
      summary: 'JavaScript capsule exported (small)',
    });
    render(<PrivacyTrustSection />);
    const row = screen.getByTestId('privacy-network-row-capsule-export');
    // The last-call cell is no longer the "Never" placeholder.
    expect(row.textContent).not.toContain('Never');
  });

  it('localizes relative times in the Recent activity feed', async () => {
    await i18next.changeLanguage('es');
    useTrustEventStore.getState().record({
      feature: 'telemetry',
      action: 'event_sent',
      sensitivity: 'low',
      summary: 'Telemetry event sent',
    });
    render(<PrivacyTrustSection />);
    expect(screen.getByTestId('privacy-recent-list').textContent).toContain('hace');
    expect(screen.getByTestId('privacy-recent-list').textContent).not.toContain('ago');
  });

  it('deep-links Network rows to the owning Settings tab (fold F)', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<PrivacyTrustSection />);
    // telemetry → account (PrivacySection consent toggle lives there).
    const telemetryLink = screen.getByTestId('privacy-network-deeplink-telemetry');
    fireEvent.click(telemetryLink);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lingua-settings-navigate-tab', detail: 'account' })
    );
    // updates → general; a feature with no destination renders no button.
    expect(screen.getByTestId('privacy-network-deeplink-updates')).toBeTruthy();
    expect(screen.queryByTestId('privacy-network-deeplink-capsule-export')).toBeNull();
    dispatchSpy.mockRestore();
  });
});
