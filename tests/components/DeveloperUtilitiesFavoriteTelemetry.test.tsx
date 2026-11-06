import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeveloperUtilitiesModal } from '@/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { UTILITY_HISTORY_STORAGE_KEY, useUtilityHistoryStore } from '@/stores/utilityHistoryStore';

const track = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useTelemetry', () => ({ useTelemetry: () => ({ track }) }));

describe('favorite telemetry', () => {
  beforeEach(() => {
    track.mockClear();
    localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
    useUtilityHistoryStore.setState({ history: {}, persistEnabled: {}, favorites: [] });
  });

  it('reports a pin made in this tab', () => {
    render(<DeveloperUtilitiesModal onClose={() => {}} />);

    act(() => useUtilityHistoryStore.getState().pinFavorite('base64'));

    expect(track).toHaveBeenCalledWith('utility.favorite.pinned', { utilityId: 'base64', count: 1 });
  });

  it('leaves a pin from another tab to the tab that reported it', () => {
    render(<DeveloperUtilitiesModal onClose={() => {}} />);
    const version = useUtilityHistoryStore.persist.getOptions().version;

    act(() => {
      localStorage.setItem(
        UTILITY_HISTORY_STORAGE_KEY,
        JSON.stringify({ state: { history: {}, persistEnabled: {}, favorites: ['base64'] }, version })
      );
      window.dispatchEvent(new StorageEvent('storage', { key: UTILITY_HISTORY_STORAGE_KEY }));
    });

    expect(useUtilityHistoryStore.getState().favorites).toEqual(['base64']);
    expect(track).not.toHaveBeenCalledWith('utility.favorite.pinned', expect.anything());
  });
});
