import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { useUtilityWorkspaceStore } from '../../src/renderer/stores/utilityWorkspaceStore';
import { useUtilityPipelineStore } from '../../src/renderer/stores/utilityPipelineStore';
import { createBlankPipeline, PIPELINE_CAP } from '../../src/shared/utilityPipeline';
import {
  UTILITY_PANEL_WARM_UP_TIMEOUT_MS,
  warmUpUtilityPanels,
} from '../__fixtures__/utilityPanels';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

// Resolve every lazy panel this file opens before any test runs
// (tests/__fixtures__/utilityPanels.tsx).
beforeAll(
  () =>
    warmUpUtilityPanels([
      'base64',
      'color',
      'diff',
      'json',
      'jwt',
      'mock-data',
      'number-base',
      'regex',
      'timestamp',
      'utility-pipelines',
    ]),
  UTILITY_PANEL_WARM_UP_TIMEOUT_MS
);

describe('DeveloperUtilitiesModal', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    useSettingsStore.getState().resetShortcutOverrides();
    useUtilityHistoryStore.setState({
      history: {},
      persistEnabled: {},
      favorites: [],
    });
    // Most cases browse the list; the rail cases fold it explicitly.
    useUtilityWorkspaceStore.setState({
      activeUtilityId: 'json',
      pendingUtilityInput: null,
      toolListOpen: true,
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
    useUtilityWorkspaceStore.getState().setActiveUtilityId('jwt');

    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('developer-utilities-workspace')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'JWT Debugger' })).toBeTruthy();
    // Space audit: the workspace view carries NO local header — neither
    // the old title box nor the status pills, which now render in the
    // shell's shared editor chips row (asserted in AppLayout.test).
    // The workspace keeps a visually hidden landmark heading for assistive tech,
    // but does not restore the removed visible title box.
    expect(
      screen.getByRole('heading', { name: 'Built-in utilities' }).className
    ).toContain('sr-only');
    expect(screen.queryByText('Copy output')).toBeNull();

    // The open tool's category starts open; the others are collapsed rows.
    expect(screen.getByTestId('utility-category-crypto').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('utility-item-json')).toBeNull();
    await user.click(screen.getByTestId('utility-category-data'));
    await user.click(screen.getByTestId('utility-item-json'));

    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('json');
    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();
  });

  it('lists favorites while browsing and ranked results while searching', async () => {
    const user = userEvent.setup();
    useUtilityHistoryStore.setState({
      favorites: ['jwt', 'timestamp'],
    });
    useUtilityWorkspaceStore.setState({ activeUtilityId: 'jwt' });

    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // A tool in Favorites keeps its category closed: the favorite row is its row.
    expect(screen.getByTestId('utility-category-crypto').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('utility-favorite-jwt').dataset.selected).toBe('true');
    expect(screen.getByTestId('utility-preview-timestamp').textContent).toMatch(/^\d{10}$/u);

    await user.type(screen.getByTestId('utilities-search-input'), 'jwt');
    expect(screen.queryByTestId('utilities-favorites-row')).toBeNull();
    expect(screen.queryByTestId('utility-item-timestamp')).toBeNull();
    expect(screen.getByTestId('utility-item-jwt')).toBeTruthy();

    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('utility-favorite-open-timestamp'));
    expect(screen.getByRole('heading', { name: 'Timestamp Converter' })).toBeTruthy();
  });

  it('opens the category of a selected favorite once it is unpinned', async () => {
    const user = userEvent.setup();
    useUtilityHistoryStore.setState({ favorites: ['hash'] });
    useUtilityWorkspaceStore.setState({ activeUtilityId: 'hash' });
    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(screen.getByTestId('utility-category-crypto').getAttribute('aria-expanded')).toBe('false');

    await user.click(screen.getByTestId('utility-favorite-unpin-hash'));

    expect(screen.getByTestId('utility-category-crypto').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('utility-item-hash').getAttribute('aria-pressed')).toBe('true');
  });

  it('counts each category and saved pipelines, and opens Pipelines from the footer', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const counts = ['data', 'web', 'crypto', 'text', 'visual', 'time'].map(
      category => screen.getByTestId(`utility-category-${category}`).textContent
    );
    expect(counts).toEqual(['Data7', 'Web6', 'Encoding & crypto5', 'Text8', 'Visual3', 'Time2']);
    expect(screen.queryByTestId('utility-launcher-pipelines-count')).toBeNull();

    await user.click(screen.getByTestId('utility-category-time'));
    expect(screen.getByTestId('utility-item-cron-parser')).toBeTruthy();
    await user.click(screen.getByTestId('utility-category-time'));
    expect(screen.queryByTestId('utility-item-cron-parser')).toBeNull();

    await user.click(screen.getByTestId('utility-launcher-pipelines'));
    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('utility-pipelines');
    expect(screen.getByTestId('utility-launcher-pipelines').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps utility draft inputs while navigating within an open Utilities workspace tab', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.click(screen.getByTestId('utility-category-crypto'));
    await user.click(screen.getByTestId('utility-item-base64'));
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const base64Panel = () => within(screen.getByTestId('utility-panel-cache-base64'));
    fireEvent.change(base64Panel().getByLabelText('Input'), {
      target: { value: 'draft stays here' },
    });

    await user.click(screen.getByTestId('utility-item-json'));
    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();

    await user.click(screen.getByTestId('utility-item-base64'));
    expect((base64Panel().getByLabelText('Input') as HTMLTextAreaElement).value).toBe(
      'draft stays here'
    );
  });

  it('remembers a utility selected from outside the sidebar (palette path) in the keep-mounted cache', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Simulate the command palette writing the active utility straight to
    // the store — no sidebar click, so only the selectedUtilityId sync
    // effect can remember it in the keep-mounted cache.
    act(() => {
      useUtilityWorkspaceStore.getState().setActiveUtilityId('base64');
    });
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    const base64Panel = () => within(screen.getByTestId('utility-panel-cache-base64'));
    fireEvent.change(base64Panel().getByLabelText('Input'), {
      target: { value: 'palette draft' },
    });

    await user.click(screen.getByTestId('utility-item-json'));
    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();

    await user.click(screen.getByTestId('utility-item-base64'));
    expect((base64Panel().getByLabelText('Input') as HTMLTextAreaElement).value).toBe(
      'palette draft'
    );
  });

  it('previews where a tool output can go and sends it with the tool as its source', async () => {
    useUtilityPipelineStore.setState({ pipelines: [], inputsByPipelineId: {}, activePipelineId: null, pendingRunPipelineId: null });
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    const cards = await screen.findAllByTestId('utility-send-output-card');
    expect(cards.map(card => card.dataset.utilityId)).toEqual(['hash', 'base64-encode', 'json-minify']);
    expect(screen.getAllByTestId('utility-send-output-preview')[0]!.textContent).toMatch(/^[0-9a-f]{6}…[0-9a-f]{4}$/);
    await user.click(cards[2]!);
    const state = useUtilityPipelineStore.getState();
    expect(state.pipelines[0]).toMatchObject({ name: 'JSON Formatter', sourceToolId: 'json', steps: [{ utilityId: 'json-minify' }] });
    expect(useUtilityWorkspaceStore.getState().activeUtilityId).toBe('utility-pipelines');
    // The new pipeline runs on its own once it is on screen.
    await waitFor(() => expect(screen.getAllByTestId('utility-pipeline-result-row')[0]!.dataset.status).toBe('ok'));
  });

  it('keeps the empty-output and full-library notices on a card', async () => {
    useUtilityPipelineStore.setState({
      pipelines: Array.from({ length: PIPELINE_CAP }, (_, index) => createBlankPipeline({ id: `p${index}` })),
    });
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    const [hash] = await screen.findAllByTestId('utility-send-output-card');
    await user.click(hash!);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('utilityPipeline.send.capReached');
    const input = screen.getByLabelText('Input');
    await user.clear(input);
    await waitFor(() => expect(screen.queryAllByTestId('utility-send-output-preview')).toHaveLength(0));
    await user.click(screen.getAllByTestId('utility-send-output-card')[0]!);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('utilityPipeline.send.empty');
    expect(useUtilityPipelineStore.getState().pipelines).toHaveLength(PIPELINE_CAP);
  });

  it('offers Send output below a tool, not on the Pipelines tool', async () => {
    useUtilityWorkspaceStore.setState({ activeUtilityId: 'json' });
    const { unmount } = render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(screen.getByTestId('utility-send-output')).toBeTruthy();
    unmount();
    useUtilityWorkspaceStore.setState({ activeUtilityId: 'utility-pipelines' });
    render(<DeveloperUtilitiesWorkspaceView />);
    expect(screen.queryByTestId('utility-send-output')).toBeNull();
  });

  it('opens Pipelines on Free with no upgrade notice', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByRole('heading', { name: 'JSON Formatter' })).toBeTruthy();

    await user.type(screen.getByTestId('utilities-search-input'), 'pipeline');
    await user.click(await screen.findByTestId('utility-item-utility-pipelines'));
    // This panel is lazy-loaded. Full-suite transform contention can make the
    // import exceed Testing Library's 1 s default without changing behavior.
    expect(
      await screen.findByTestId('utility-pipeline-panel', undefined, { timeout: 5000 })
    ).toBeTruthy();
    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('folds the workspace list to an icon rail and opens it at a category', async () => {
    const user = userEvent.setup();
    useUtilityWorkspaceStore.setState({ activeUtilityId: 'jwt', toolListOpen: false });

    render(<DeveloperUtilitiesWorkspaceView />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('developer-utilities-workspace-body').dataset.toolList).toBe('rail');
    expect(screen.queryByTestId('utilities-search-input')).toBeNull();
    expect(screen.getByTestId('utility-rail-crypto').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('utility-rail-text').getAttribute('aria-pressed')).toBe('false');

    // jsdom has no scrollIntoView; the rail scrolls the list to the picked category.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      await user.click(screen.getByTestId('utility-rail-time'));
      expect(useUtilityWorkspaceStore.getState().toolListOpen).toBe(true);
      const timeHeading = await screen.findByTestId('utility-category-time');
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
      expect(scrollIntoView.mock.contexts[0]).toBe(timeHeading);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }

    await user.click(screen.getByTestId('utility-list-collapse'));
    expect(useUtilityWorkspaceStore.getState().toolListOpen).toBe(false);
    expect(screen.getByTestId('utility-rail')).toBeTruthy();
  });

  it('lets the open list fill a narrow tab and shows the tool once one is picked', async () => {
    const user = userEvent.setup();
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 375, height: 800, top: 0, left: 0, right: 375, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
    try {
      render(<DeveloperUtilitiesWorkspaceView />);
      await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
      expect(screen.getByRole('heading', { name: 'JSON Formatter' }).closest('main')?.className).toContain('hidden');

      await user.click(screen.getByTestId('utility-item-number-base'));
      // The saved list preference is left alone; only this narrow tab shows the tool.
      expect(useUtilityWorkspaceStore.getState().toolListOpen).toBe(true);
      expect(screen.getByTestId('utility-rail')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Number Base Converter' }).closest('main')?.className).not.toContain('hidden');

      await user.click(screen.getByTestId('utility-rail-expand'));
      expect(screen.getByTestId('utilities-search-input')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Number Base Converter' }).closest('main')?.className).toContain('hidden');
    } finally {
      rect.mockRestore();
    }
  });

  it('keeps the full card list in the modal', async () => {
    useUtilityWorkspaceStore.setState({ toolListOpen: false });
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
    expect(screen.queryByTestId('utility-rail')).toBeNull();
    expect(screen.getByTestId('utilities-search-input')).toBeTruthy();
  });

  it('supports opening directly into a selected utility', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="timestamp" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByRole('heading', { name: 'Timestamp Converter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use current time' })).toBeTruthy();
  });

  it('groups the browse view by category and drops the headings while searching', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    // Browse view: category headings label the sections.
    expect(screen.getByTestId('utility-category-data')).toBeTruthy();
    expect(screen.getByTestId('utility-category-web')).toBeTruthy();
    expect(screen.getByTestId('utility-category-crypto')).toBeTruthy();

    // Searching collapses to a single ranked run — no category headings.
    await user.type(screen.getByTestId('utilities-search-input'), 'json');
    await waitFor(() => {
      expect(screen.queryByTestId('utility-category-data')).toBeNull();
    });
    expect(screen.queryByTestId('utility-category-web')).toBeNull();
  });

  it('focuses search on open and navigates utilities with arrow keys', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const search = screen.getByTestId('utilities-search-input');
    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });

    // The no-query browse view is grouped by category, so the
    // second item is the next tool in the "Data" section (json →
    // number-base → yaml-json), not the old flat-catalog neighbour.
    await user.keyboard('{ArrowDown}');

    const numberBaseItem = screen.getByTestId('utility-item-number-base');
    await waitFor(() => {
      expect(document.activeElement).toBe(numberBaseItem);
    });
    expect(screen.getByRole('heading', { name: 'Number Base Converter' })).toBeTruthy();

    await user.keyboard('{ArrowDown}');

    const mockDataItem = screen.getByTestId('utility-item-mock-data');
    await waitFor(() => {
      expect(document.activeElement).toBe(mockDataItem);
    });
    expect(screen.getByRole('heading', { name: 'Mock Data Generator' })).toBeTruthy();

    await user.keyboard('{ArrowUp}');

    await waitFor(() => {
      expect(document.activeElement).toBe(numberBaseItem);
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

    // Use the testid because the panel adds a sibling
    // FavoriteToggleButton whose aria-label also contains "Base64
    // Encoder" (e.g. "Pin Base64 Encoder to favorites").
    await user.click(screen.getByTestId('utility-category-crypto'));
    await user.click(screen.getByTestId('utility-item-base64'));
    const base64Panel = within(screen.getByTestId('utility-panel-cache-base64'));

    expect(screen.getByRole('heading', { name: 'Base64 Encoder' })).toBeTruthy();
    expect((base64Panel.getByLabelText('Output') as HTMLTextAreaElement).value).toBe(
      'TGluZ3VhIHV0aWxpdGllcw=='
    );

    await user.click(screen.getByRole('button', { name: 'Decode' }));
    await user.clear(base64Panel.getByLabelText('Input'));
    await user.type(base64Panel.getByLabelText('Input'), 'TGluZ3Vh');

    expect((base64Panel.getByLabelText('Output') as HTMLTextAreaElement).value).toBe('Lingua');
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
