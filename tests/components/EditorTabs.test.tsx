import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetActiveTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockCloseTab = vi.fn().mockResolvedValue(true);
const mockRenameTab = vi.fn();
const mockDuplicateActiveTab = vi.fn();
const mockCloseOtherTabs = vi.fn().mockResolvedValue(undefined);
const mockCloseTabsToRight = vi.fn().mockResolvedValue(undefined);
const mockCloseAllTabs = vi.fn().mockResolvedValue(undefined);

const mockTabs = [
  {
    id: 'tab-js',
    name: 'untitled.js',
    language: 'javascript',
    content: 'console.log("hello")',
    isDirty: true,
  },
  {
    id: 'tab-go',
    name: 'main.go',
    language: 'go',
    content: 'package main',
    isDirty: false,
  },
];

const mockState = {
  tabs: mockTabs,
  activeTabId: 'tab-go',
  setActiveTab: mockSetActiveTab,
  removeTab: mockRemoveTab,
  closeTab: mockCloseTab,
  renameTab: mockRenameTab,
  duplicateActiveTab: mockDuplicateActiveTab,
  closeOtherTabs: mockCloseOtherTabs,
  closeTabsToRight: mockCloseTabsToRight,
  closeAllTabs: mockCloseAllTabs,
};

// Zustand-style selector hook: when the component pulls a single
// field via `useEditorStore((state) => state.tabs)`, the mock has to
// run the selector against the snapshot rather than always returning
// the whole object. Without this, every selected field collapses to
// `undefined.tabs` and the map() call below explodes.
vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: <T,>(selector?: (state: typeof mockState) => T) =>
    selector ? selector(mockState) : mockState,
}));

vi.mock('lucide-react', () => {
  // Icons used by the overflow popover + tab-kind glyphs. Rendered as
  // inert spans so the overflow path (which mounts ChevronDown) doesn't
  // explode on an undefined component.
  const Stub = () => <span aria-hidden="true" />;
  return {
    Loader2: (props: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>loading</span>,
    X: () => <span>x</span>,
    ChevronDown: Stub,
    Database: Stub,
    Globe: Stub,
    BookOpen: Stub,
    Wrench: Stub,
  };
});

import { EditorTabs } from '../../src/renderer/components/Editor/EditorTabs';

describe('EditorTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const tab of mockTabs) {
      delete (tab as { executionState?: unknown }).executionState;
      delete (tab as { parseError?: unknown }).parseError;
    }
  });

  it('renders an accessible open-files group with current state', () => {
    render(<EditorTabs />);

    expect(screen.getByRole('group', { name: 'Open files' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'JS untitled.js' }).getAttribute('aria-current')
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Go main.go' }).getAttribute('aria-current')
    ).toBe('page');
  });

  it('exposes the unsaved marker with an accessible label', () => {
    render(<EditorTabs />);

    expect(screen.getByLabelText('untitled.js has unsaved changes')).toBeTruthy();
  });

  it('separates tab activation from the close action', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    await user.click(screen.getByRole('button', { name: 'JS untitled.js' }));
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');

    await user.click(screen.getByRole('button', { name: 'Close untitled.js' }));
    expect(mockCloseTab).toHaveBeenCalledWith('tab-js');
  });

  it('keeps the close action available while a tab is running', async () => {
    const user = userEvent.setup();
    (mockTabs[1] as { executionState?: string }).executionState = 'running';
    render(<EditorTabs />);

    expect(screen.getByTestId('editor-tab-running-spinner')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close main.go' }));

    expect(mockCloseTab).toHaveBeenCalledWith('tab-go');
  });

  it('activates a tab when clicking anywhere on the card, not only the label', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    // Click the padding area on the right side of the tab (between the
    // label and the close button). Before this fix only the label text
    // triggered activation — the surrounding rounded surface was dead
    // space.
    const tab = screen.getByRole('button', { name: 'JS untitled.js' });
    await user.pointer({ target: tab, coords: { clientX: 1, clientY: 1 } });
    await user.click(tab);

    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');
  });

  it('activates a tab from the keyboard via Enter and Space', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const tab = screen.getByRole('button', { name: 'JS untitled.js' });
    await act(async () => {
      tab.focus();
    });

    await user.keyboard('{Enter}');
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');

    mockSetActiveTab.mockClear();
    await user.keyboard(' ');
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');
  });

  it('moves between tabs with the arrow keys (roving tabindex) (accessibility pass)', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const goTab = screen.getByRole('button', { name: 'Go main.go' });
    await act(async () => {
      goTab.focus();
    });

    // ArrowLeft from the (last) Go tab moves to the JS tab: selection follows
    // focus, and focus lands on the JS tab's activation element.
    await user.keyboard('{ArrowLeft}');
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');
    const jsTab = screen.getByRole('button', { name: 'JS untitled.js' });
    await waitFor(() => expect(document.activeElement).toBe(jsTab));

    // Home jumps to the first tab; End to the last.
    mockSetActiveTab.mockClear();
    await user.keyboard('{End}');
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-go');
  });

  it('shows the tab filename in the shared tooltip layer', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    await user.hover(screen.getByRole('button', { name: 'Go main.go' }));

    expect(screen.getByRole('tooltip').textContent).toContain('main.go');
  });

  it('opens the context menu on right-click anchored to the tab', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const tab = screen.getByRole('button', { name: 'JS untitled.js' });
    await user.pointer({ keys: '[MouseRight]', target: tab });

    // Right-click activates the tab AND opens the menu — both
    // matter for the user's mental model: the menu always anchors
    // to whatever tab is now active, never to a stale selection.
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');
    const menu = screen.getByTestId('editor-tab-context-menu');
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('aria-label')).toContain('untitled.js');
  });

  it('opens the context menu from the keyboard and supports arrow navigation', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const activeTab = screen.getByRole('button', { name: 'Go main.go' });
    await act(async () => {
      activeTab.focus();
    });
    await user.keyboard('{Shift>}{F10}{/Shift}');

    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-go');
    const closeItem = screen.getAllByRole('menuitem')[0];
    expect(document.activeElement).toBe(closeItem);

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: /^Close others/ })
    );

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: /^Duplicate/ })
    );
  });

  it('returns focus to the triggering tab when the context menu closes (accessibility pass)', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const activeTab = screen.getByRole('button', { name: 'Go main.go' });
    await act(async () => {
      activeTab.focus();
    });
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(screen.getByTestId('editor-tab-context-menu')).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('editor-tab-context-menu')).toBeNull()
    );
    // Focus was on a menuitem; on close it returns to the tab, not body.
    await waitFor(() => expect(document.activeElement).toBe(activeTab));
  });

  it('routes context menu actions through the matching store helpers', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'JS untitled.js' }),
    });

    await user.click(screen.getByRole('menuitem', { name: /^Close others/ }));
    expect(mockCloseOtherTabs).toHaveBeenCalledWith('tab-js');

    // The menu closes after each action; reopen for the next
    // assertion so we exercise the full open → click → close cycle.
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'JS untitled.js' }),
    });
    await user.click(screen.getByRole('menuitem', { name: /^Close all/ }));
    expect(mockCloseAllTabs).toHaveBeenCalled();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'JS untitled.js' }),
    });
    await user.click(screen.getByRole('menuitem', { name: /^Duplicate/ }));
    expect(mockDuplicateActiveTab).toHaveBeenCalled();
  });

  it('starts inline rename on double-click and commits the new name on Enter', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const tab = screen.getByRole('button', { name: 'JS untitled.js' });
    // The filename span lives inside the file button; targeting the button
    // node bubbles to it without depending on a fragile testid.
    const filename = tab.querySelector('span.font-mono') as HTMLElement;
    await user.dblClick(filename);

    const input = screen.getByTestId('editor-tab-rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    await user.clear(input);
    await user.type(input, 'renamed.ts');
    await user.keyboard('{Enter}');

    expect(mockRenameTab).toHaveBeenCalledWith('tab-js', 'renamed.ts');
    expect(mockRenameTab).toHaveBeenCalledTimes(1);
  });

  it('cancels inline rename on Escape without calling renameTab', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const tab = screen.getByRole('button', { name: 'JS untitled.js' });
    const filename = tab.querySelector('span.font-mono') as HTMLElement;
    await user.dblClick(filename);

    const input = screen.getByTestId('editor-tab-rename-input') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'discarded');
    await user.keyboard('{Escape}');

    expect(mockRenameTab).not.toHaveBeenCalled();
    // Input is gone; the tooltip + tab labels still announce the
    // original name. Use queryAllByText so the multiple references
    // (tab aria-label, filename span, tooltip) do not trip the
    // assertion — what matters is that AT LEAST one survives.
    expect(screen.queryByTestId('editor-tab-rename-input')).toBeNull();
    expect(screen.queryAllByText('untitled.js').length).toBeGreaterThan(0);
  });

  describe('overflow popover keyboard + focus (accessibility pass)', () => {
    const manyTabs = Array.from({ length: 7 }, (_, index) => ({
      id: `ov-${index}`,
      name: `file-${index}.js`,
      language: 'javascript',
      content: '',
      isDirty: false,
    }));

    beforeEach(() => {
      mockState.tabs = manyTabs as typeof mockState.tabs;
      mockState.activeTabId = 'ov-0';
    });

    afterEach(() => {
      mockState.tabs = mockTabs;
      mockState.activeTabId = 'tab-go';
    });

    it('moves focus into the menu (the active row) when the overflow opens', async () => {
      const user = userEvent.setup();
      render(<EditorTabs />);

      await user.click(screen.getByTestId('editor-tabs-overflow'));
      // The active tab's row is the focus seed so ↑↓ has a starting point.
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByTestId('editor-tabs-overflow-item-ov-0')
        )
      );
    });

    it('implements the ↑↓ roving the footer advertises', async () => {
      const user = userEvent.setup();
      render(<EditorTabs />);

      await user.click(screen.getByTestId('editor-tabs-overflow'));
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByTestId('editor-tabs-overflow-item-ov-0')
        )
      );
      await user.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(
        screen.getByTestId('editor-tabs-overflow-item-ov-1')
      );
      await user.keyboard('{End}');
      expect(document.activeElement).toBe(
        screen.getByTestId('editor-tabs-overflow-item-ov-6')
      );
    });

    it('returns focus to the overflow trigger on Escape', async () => {
      const user = userEvent.setup();
      render(<EditorTabs />);

      const trigger = screen.getByTestId('editor-tabs-overflow');
      await user.click(trigger);
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByTestId('editor-tabs-overflow-item-ov-0')
        )
      );
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(
          screen.queryByTestId('editor-tabs-overflow-item-ov-0')
        ).toBeNull()
      );
      expect(document.activeElement).toBe(trigger);
    });
  });
});
