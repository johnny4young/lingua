import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import {
  FavoriteToggleButton,
  FavoritesRow,
} from '../../src/renderer/components/DeveloperUtilities/FavoritesRow';
import {
  UTILITY_HISTORY_STORAGE_KEY,
  useUtilityHistoryStore,
} from '../../src/renderer/stores/utilityHistoryStore';

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useUtilityHistoryStore.setState(
    { history: {}, persistEnabled: {}, favorites: [] },
    false
  );
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

describe('FavoritesRow ', () => {
  it('renders nothing when there are no pinned utilities', () => {
    const { container } = render(
      <FavoritesRow selectedUtilityId="json" onSelect={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders pinned utilities in order with selection state', () => {
    useUtilityHistoryStore.getState().pinFavorite('json');
    useUtilityHistoryStore.getState().pinFavorite('base64');

    render(<FavoritesRow selectedUtilityId="base64" onSelect={vi.fn()} />);

    const chips = screen.getAllByTestId(/^utility-favorite-(?!toggle-).+/);
    expect(chips).toHaveLength(2);
    expect(chips[0]?.getAttribute('data-testid')).toBe('utility-favorite-json');
    expect(chips[1]?.getAttribute('data-testid')).toBe('utility-favorite-base64');
    expect(chips[1]?.getAttribute('data-selected')).toBe('true');
  });

  it('reorders pinned utilities with the keyboard drag handle', async () => {
    const user = userEvent.setup();
    useUtilityHistoryStore.getState().pinFavorite('json');
    useUtilityHistoryStore.getState().pinFavorite('base64');

    render(<FavoritesRow selectedUtilityId="json" onSelect={vi.fn()} />);

    const grip = screen.getByRole('button', {
      name: 'Drag JSON Formatter to reorder favorites',
    });
    grip.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard(' ');

    expect(useUtilityHistoryStore.getState().favorites).toEqual(['base64', 'json']);
  });

  it('FavoriteToggleButton pins and unpins idempotently', () => {
    render(<FavoriteToggleButton utilityId="jwt" />);
    const button = screen.getByTestId('utility-favorite-toggle-jwt');

    expect(button.getAttribute('data-pinned')).toBeNull();
    fireEvent.click(button);
    expect(useUtilityHistoryStore.getState().favorites).toEqual(['jwt']);
    expect(button.getAttribute('data-pinned')).toBe('true');

    fireEvent.click(button);
    expect(useUtilityHistoryStore.getState().favorites).toEqual([]);
    expect(button.getAttribute('data-pinned')).toBeNull();
  });

  it('FavoriteToggleButton announces the localized aria-label', () => {
    render(<FavoriteToggleButton utilityId="json" />);
    const button = screen.getByTestId('utility-favorite-toggle-json');
    expect(button.getAttribute('aria-label')).toContain('Pin');
    fireEvent.click(button);
    expect(button.getAttribute('aria-label')).toContain('Remove');
  });
});
