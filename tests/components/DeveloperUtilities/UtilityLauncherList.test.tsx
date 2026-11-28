import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NON_SECRET_TEST_JWT as JWT } from '../../__fixtures__/jwt';
import { UTILITY_PANEL_WARM_UP_TIMEOUT_MS, warmUpUtilityPanels } from '../../__fixtures__/utilityPanels';

const { peek } = vi.hoisted(() => ({ peek: { current: null as { kind: 'jwt'; text: string; chars: number } | null } }));

vi.mock('../../../src/renderer/hooks/useClipboardSuggestion', () => ({
  useClipboardSuggestion: (active: boolean) => (active ? peek.current : null),
}));
vi.mock('../../../src/renderer/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DeveloperUtilitiesWorkspaceView } from '../../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { initI18n } from '../../../src/renderer/i18n';
import { useUtilityHistoryStore } from '../../../src/renderer/stores/utilityHistoryStore';
import { useUtilityWorkspaceStore } from '../../../src/renderer/stores/utilityWorkspaceStore';

const CLIPBOARD_ROWS = ['jwt', 'hash', 'base64', 'string-inspector', 'url', 'qr-code'];
// A fresh object per test: the previews are keyed by the peek itself.
const jwtPeek = () => ({ kind: 'jwt' as const, text: JWT, chars: JWT.length });

beforeAll(() => warmUpUtilityPanels(['jwt', 'hash']), UTILITY_PANEL_WARM_UP_TIMEOUT_MS);

describe('Utilities launcher list', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    peek.current = jwtPeek();
    useUtilityHistoryStore.setState({ history: {}, persistEnabled: {}, favorites: [] });
    useUtilityWorkspaceStore.setState({ activeUtilityId: 'jwt', pendingUtilityInput: null, toolListOpen: true });
  });

  it('heads the list with the clipboard tools and their previews, except the open tool', async () => {
    render(<DeveloperUtilitiesWorkspaceView />);

    expect(screen.getByTestId('utility-launcher-clipboard-head').textContent).toBe(`Your clipboardJWT · ${JWT.length} chars`);
    const rows = screen.getAllByTestId(/^utility-clipboard-/u).map(row => row.dataset.testid);
    expect(rows).toEqual(CLIPBOARD_ROWS.map(id => `utility-clipboard-${id}`));
    await waitFor(() => expect(screen.getByTestId('utility-preview-hash').textContent).toMatch(/^[0-9a-f]{6}…[0-9a-f]{4}$/u));
    expect(screen.getByTestId('utility-preview-url').textContent).toBe('no change');
    expect(screen.getByTestId('utility-preview-string-inspector').textContent).toBe('0 hidden');
    expect(screen.getByTestId('utility-preview-qr-code').textContent).toMatch(/^v\d+ · M$/u);
    expect(screen.queryByTestId('utility-preview-jwt')).toBeNull();
    expect(screen.getByTestId('utility-clipboard-jwt').getAttribute('aria-pressed')).toBe('true');
    // The open tool's row is the clipboard one, so its category stays closed.
    expect(screen.getByTestId('utility-category-crypto').getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain(JWT);
  });

  it('walks the clipboard rows first with the arrow keys and drops a preview once its tool opens', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.getByTestId('utility-preview-hash')).toBeTruthy());

    screen.getByTestId('utilities-search-input').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('utility-clipboard-hash')));
    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('hash');
    expect(screen.queryByTestId('utility-preview-hash')).toBeNull();
    expect(screen.getByTestId('utility-preview-jwt').textContent).toBe('2 claims');
  });

  it('walks the rows on screen, so arrows inside a category stay in it', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await user.click(screen.getByTestId('utility-category-crypto'));
    await user.click(screen.getByTestId('utility-item-hash'));
    // JWT also heads the clipboard group; the walk stays on its category row.
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('utility-item-jwt')));
    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('jwt');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    // A category row takes focus without opening a tool.
    expect(document.activeElement).toBe(screen.getByTestId('utility-category-text'));
    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('base64-image');
  });

  it('keeps today’s list without a clipboard read', () => {
    peek.current = null;
    render(<DeveloperUtilitiesWorkspaceView />);
    expect(screen.queryByTestId('utility-launcher-clipboard-head')).toBeNull();
    expect(screen.queryByTestId('utility-launcher-clipboard')).toBeNull();
    expect(screen.queryByTestId(/^utility-preview-/u)).toBeNull();
    expect(screen.getByTestId('utility-category-crypto').getAttribute('aria-expanded')).toBe('true');
  });

  it('marks clipboard tools with the bulb while searching', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await user.type(screen.getByTestId('utilities-search-input'), 'base');
    expect(screen.getByTestId('utility-suggested-base64')).toBeTruthy();
    expect(screen.queryByTestId('utility-launcher-clipboard')).toBeNull();
  });
});
