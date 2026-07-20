/**
 * internal — URL Parser utility component tests. The pure parser is covered
 * end-to-end in tests/utils/urlParser.test.ts, so this suite focuses on
 * the panel behaviors that matter to users: live propagation, error
 * states, password masking, query table rendering, and ES locale parity.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <div onClick={onClose}>{children}</div>
  ),
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('UrlParserUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders every component from the seeded sample URL', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="url-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('url-parser-protocol').textContent).toBe('https:');
    expect(screen.getByTestId('url-parser-hostname').textContent).toBe('api.lingua.dev');
    expect(screen.getByTestId('url-parser-port').textContent).toBe('8443');
    expect(screen.getByTestId('url-parser-pathname').textContent).toBe('/v1/items');
    expect(screen.getByTestId('url-parser-hash').textContent).toBe('#results');
  });

  it('keeps the password masked by default and only reveals on user intent', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="url-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const passwordCell = screen.getByTestId('url-parser-password');
    // Six bullets for the six-character sample password "secret".
    expect(passwordCell.textContent).toBe('••••••');

    await user.click(screen.getByTestId('url-parser-password-reveal'));
    expect(passwordCell.textContent).toBe('secret');

    await user.click(screen.getByTestId('url-parser-password-reveal'));
    expect(passwordCell.textContent).toBe('••••••');
  });

  it('renders one query row per parameter, preserving duplicate keys and order', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="url-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const rows = screen.getAllByTestId('url-parser-query-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('tag');
    expect(rows[0]?.textContent).toContain('dev');
    expect(rows[1]?.textContent).toContain('tag');
    expect(rows[1]?.textContent).toContain('web');
    expect(rows[2]?.textContent).toContain('page');
    expect(rows[2]?.textContent).toContain('2');
  });

  it('swaps to the empty-query panel when the input URL has no search string', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="url-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('url-parser-input') as HTMLTextAreaElement;
    await user.clear(input);
    await user.type(input, 'https://example.com/path');

    expect(screen.queryByTestId('url-parser-query-table')).toBeNull();
    expect(screen.getByText('This URL has no query string.')).toBeTruthy();
  });

  it('shows the idle hint on empty input and the invalid hint on unparseable input', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="url-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('url-parser-input') as HTMLTextAreaElement;

    await user.clear(input);
    expect(screen.getByText('Paste a URL to see its parts.')).toBeTruthy();
    expect(screen.queryByTestId('url-parser-hostname')).toBeNull();

    await user.type(input, 'not a url');
    expect(screen.getByText('That string is not a valid URL.')).toBeTruthy();
    expect(screen.queryByTestId('url-parser-hostname')).toBeNull();
  });

  it('falls back cleanly to Spanish copy when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="url-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // The inner PanelSection heading is level 3 and localized; the modal
    // header is level 2 and also localized. Narrow to level 3 to pin the
    // assertion to the URL parser's own panel title.
    expect(screen.getByRole('heading', { level: 3, name: /Analizador de URL/i })).toBeTruthy();
    expect(screen.getByText('Parámetros del query')).toBeTruthy();
  });
});
