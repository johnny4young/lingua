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
});
