/**
 * RL-093 polish #7 — smoke tests for the +N tabs overflow dropdown
 * exposed by `EditorTabs.tsx` when the open-tab list grows past 5.
 *
 * The dropdown is internal to the EditorTabs component (no public
 * export), so we exercise it end-to-end by mounting EditorTabs with a
 * 7-tab fixture, opening the +N button, and confirming:
 *   1. The button only appears once tab count exceeds 5 and reports
 *      the hidden-tab count from the handoff.
 *   2. Opening it shows a compact file-list overlay, not the command
 *      palette search input.
 *   3. Selecting a hidden tab calls `setActiveTab` with its id.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setActiveTabMock = vi.fn();
const closeTabMock = vi.fn().mockResolvedValue(true);

const SEVEN_TABS = [
  { id: 't1', name: 'alpha.js', language: 'javascript', content: '', isDirty: false },
  { id: 't2', name: 'beta.ts', language: 'typescript', content: '', isDirty: false },
  { id: 't3', name: 'gamma.go', language: 'go', content: '', isDirty: false },
  { id: 't4', name: 'delta.py', language: 'python', content: '', isDirty: false },
  { id: 't5', name: 'epsilon.rs', language: 'rust', content: '', isDirty: false },
  { id: 't6', name: 'zeta.js', language: 'javascript', content: '', isDirty: true },
  { id: 't7', name: 'eta.ts', language: 'typescript', content: '', isDirty: false },
];

const mockState = {
  tabs: SEVEN_TABS,
  activeTabId: 't1',
  setActiveTab: setActiveTabMock,
  removeTab: vi.fn(),
  closeTab: closeTabMock,
  renameTab: vi.fn(),
  duplicateActiveTab: vi.fn(),
  closeOtherTabs: vi.fn().mockResolvedValue(undefined),
  closeTabsToRight: vi.fn().mockResolvedValue(undefined),
  closeAllTabs: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: <T,>(selector?: (state: typeof mockState) => T) =>
    selector ? selector(mockState) : mockState,
}));

import { EditorTabs } from '../../src/renderer/components/Editor/EditorTabs';

describe('TabsOverflowDropdown (via EditorTabs)', () => {
  beforeEach(() => {
    setActiveTabMock.mockClear();
    closeTabMock.mockClear();
  });

  it('renders five visible tabs and a +N button with the hidden-tab count', () => {
    render(<EditorTabs />);
    const overflow = screen.getByTestId('editor-tabs-overflow');
    expect(overflow.textContent).toContain('+2');
    expect(screen.getByText('alpha.js')).toBeTruthy();
    expect(screen.getByText('epsilon.rs')).toBeTruthy();
    expect(screen.queryByText('zeta.js')).toBeNull();
  });

  it('opens the dropdown as a file list without a search field', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);
    await user.click(screen.getByTestId('editor-tabs-overflow'));
    const menu = screen.getByRole('menu');
    expect(screen.queryByTestId('editor-tabs-overflow-search')).toBeNull();
    expect(within(menu).getByText(/alpha\.js/)).toBeTruthy();
    expect(within(menu).getByText(/gamma\.go/)).toBeTruthy();
    expect(within(menu).getByText(/zeta\.js/)).toBeTruthy();
    expect(menu.textContent).not.toContain('Filter open files');
  });

  it('switches to the selected hidden tab when clicked', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);
    await user.click(screen.getByTestId('editor-tabs-overflow'));
    const menu = screen.getByRole('menu');
    // Click within the dropdown menu, not the strip's clone of the tab.
    // Anchor the regex so `eta.ts` doesn't also match `beta.ts`.
    await user.click(within(menu).getByText(/^eta\.ts$/));
    expect(setActiveTabMock).toHaveBeenCalledWith('t7');
  });

  // RL-093 review — when the user activates a tab past the 5-tab cap
  // (typically via the overflow dropdown) the active tab MUST stay
  // in the strip; otherwise the visible row has no `data-active=true`
  // and the user loses orientation.
  it('keeps the active tab visible when it sits past the 5-tab cap', () => {
    const previousActive = mockState.activeTabId;
    mockState.activeTabId = 't7';
    try {
      render(<EditorTabs />);
      // The strip still shows five tabs total: the first four plus
      // the active one bumped into the last slot.
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(5);
      // The active tab is one of them, with aria-selected=true.
      const activeTab = tabs.find(
        (tab) => tab.getAttribute('data-tab-id') === 't7'
      );
      expect(activeTab).toBeDefined();
      expect(activeTab!.getAttribute('aria-selected')).toBe('true');
      // The overflow count drops to 2 (zeta + the bumped-out fifth
      // first-window tab, epsilon).
      const overflow = screen.getByTestId('editor-tabs-overflow');
      expect(overflow.textContent).toContain('+2');
    } finally {
      mockState.activeTabId = previousActive;
    }
  });
});
