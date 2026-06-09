import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../src/renderer/i18n';
import {
  DeveloperUtilitiesModal,
  DeveloperUtilitiesWorkspaceView,
} from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useUtilityHistoryStore } from '../../src/renderer/stores/utilityHistoryStore';

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

describe('DeveloperUtilitiesModal', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    useSettingsStore.getState().resetShortcutOverrides();
    useUtilityHistoryStore.setState({
      history: {},
      persistEnabled: {},
      favorites: [],
      activeUtilityId: 'json',
    });
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    useUIStore.setState({ statusNotice: null });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
  });

  it('opens on the JSON utility by default', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('developer-utilities-modal')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pretty print' })).toBeTruthy();
  });

  it('renders the full workspace from the persisted active utility', async () => {
    const user = userEvent.setup();
    useUtilityHistoryStore.getState().setActiveUtilityId('jwt');

    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('developer-utilities-workspace')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'JWT Debugger' })).toBeTruthy();

    await user.click(screen.getByTestId('utility-item-json'));

    expect(useUtilityHistoryStore.getState().activeUtilityId).toBe('json');
    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();
  });

  it('keeps the Pipelines workflow locked on Free while base utilities render', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();

    await user.type(screen.getByTestId('utilities-search-input'), 'pipeline');
    await waitFor(() => expect(screen.getByTestId('utility-lock-utility-pipelines')).toBeTruthy());
    await user.click(screen.getByTestId('utility-item-utility-pipelines'));
    await waitFor(() => expect(screen.getByTestId('utility-pipeline-locked')).toBeTruthy());
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
  });

  it('supports opening directly into a selected utility', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="timestamp" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByRole('heading', { name: 'Timestamp Converter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use current time' })).toBeTruthy();
  });

  it('focuses search on open and navigates utilities with arrow keys', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const search = screen.getByTestId('utilities-search-input');
    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });

    await user.keyboard('{ArrowDown}');

    const base64Item = screen.getByTestId('utility-item-base64');
    await waitFor(() => {
      expect(document.activeElement).toBe(base64Item);
    });
    expect(screen.getByRole('heading', { name: 'Base64 Encoder' })).toBeTruthy();

    await user.keyboard('{ArrowDown}');

    const urlItem = screen.getByTestId('utility-item-url');
    await waitFor(() => {
      expect(document.activeElement).toBe(urlItem);
    });
    expect(screen.getByRole('heading', { name: 'URL Encoder' })).toBeTruthy();

    await user.keyboard('{ArrowUp}');

    await waitFor(() => {
      expect(document.activeElement).toBe(base64Item);
    });
  });

  it('surfaces only the copy output shortcut in the modal chrome', async () => {
    useSettingsStore
      .getState()
      .setShortcutOverride('utility-copy-output', [{ tokens: ['Mod', 'Alt', 'C'] }]);

    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.queryByLabelText('Developer utilities shortcuts')).toBeNull();
    expect(screen.getByLabelText('Utility output shortcuts')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
    expect(screen.getByText('Copy output')).toBeTruthy();
    expect(screen.queryByText('Replace clipboard')).toBeNull();
    expect(screen.queryByText('Ctrl+K')).toBeNull();
    expect(screen.getByText('Ctrl+Alt+C')).toBeTruthy();
    expect(screen.queryByText('Ctrl+Alt+R')).toBeNull();
  });

  it('switches utilities and updates derived output live', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Use the testid because RL-069 Slice 3 adds a sibling
    // FavoriteToggleButton whose aria-label also contains "Base64
    // Encoder" (e.g. "Pin Base64 Encoder to favorites").
    await user.click(screen.getByTestId('utility-item-base64'));

    expect(screen.getByRole('heading', { name: 'Base64 Encoder' })).toBeTruthy();
    expect((screen.getByLabelText('Output') as HTMLTextAreaElement).value).toBe(
      'TGluZ3VhIHV0aWxpdGllcw=='
    );

    await user.click(screen.getByRole('button', { name: 'Decode' }));
    await user.clear(screen.getByLabelText('Input'));
    await user.type(screen.getByLabelText('Input'), 'TGluZ3Vh');

    expect((screen.getByLabelText('Output') as HTMLTextAreaElement).value).toBe('Lingua');
  });

  it('shows regex matches with capture groups and a count label', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByRole('heading', { name: 'Regex Tester' })).toBeTruthy();
    expect(screen.getByText('2 matches')).toBeTruthy();

    await user.clear(screen.getByLabelText('Test string'));
    await user.type(screen.getByLabelText('Test string'), 'none here');
    expect(screen.getByText('No matches for the current pattern.')).toBeTruthy();
  });

  it('surfaces color conversions for the current input', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="color" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByRole('heading', { name: 'Color Converter' })).toBeTruthy();
    expect(screen.getByText('rgb(79, 70, 229)')).toBeTruthy();
    expect(screen.getByText('Color parsed successfully.')).toBeTruthy();
  });

  it('reports a summary when comparing two different inputs in the diff viewer', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="diff" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByRole('heading', { name: 'Diff Viewer' })).toBeTruthy();
    expect(
      screen.getByText(text => text.startsWith('2 added,') && text.includes('1 removed'))
    ).toBeTruthy();
  });

  it('formats JSON input in place', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByLabelText('Input');
    fireEvent.change(input, { target: { value: '{"name":"Lingua"}' } });
    await user.click(screen.getByRole('button', { name: 'Pretty print' }));

    expect((screen.getByLabelText('Input') as HTMLTextAreaElement).value).toBe(
      '{\n  "name": "Lingua"\n}'
    );
  });
});
