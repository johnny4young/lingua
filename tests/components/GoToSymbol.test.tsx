import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockRequestReveal = vi.fn();

const useDocumentSymbolsMock = vi.hoisted(() => vi.fn());

let mockActiveTab: { id: string; language: string; filePath?: string } | null = null;

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      tabs: mockActiveTab ? [mockActiveTab] : [],
      activeTabId: mockActiveTab?.id ?? null,
      requestReveal: mockRequestReveal,
    };
    return selector ? selector(state) : state;
  },
  getActiveTab: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.tabs.find((t) => t.id === s.activeTabId) ?? null,
  getActiveTabIndex: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.activeTabId == null ? -1 : s.tabs.findIndex((t) => t.id === s.activeTabId),
}));

vi.mock('../../src/renderer/hooks/useDocumentSymbols', () => ({
  useDocumentSymbols: useDocumentSymbolsMock,
}));

vi.mock('lucide-react', () => ({
  Search: () => <span>search</span>,
}));

import { GoToSymbol } from '../../src/renderer/components/GoToSymbol/GoToSymbol';

describe('GoToSymbol', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    mockRequestReveal.mockClear();
    mockActiveTab = {
      id: 'tab-1',
      language: 'typescript',
      filePath: '/project/src/main.ts',
    };
    useDocumentSymbolsMock.mockReset();
    useDocumentSymbolsMock.mockReturnValue({ status: 'idle', entries: [] });
  });

  it('renders a friendly empty state when there is no active tab', () => {
    mockActiveTab = null;
    useDocumentSymbolsMock.mockReturnValue({ status: 'unsupported', entries: [] });
    render(<GoToSymbol onClose={vi.fn()} />);
    expect(
      screen.getByText('Open a JavaScript or TypeScript file to browse its symbols.')
    ).toBeTruthy();
  });

  it('explains the limitation for non-JS/TS languages', () => {
    mockActiveTab = { id: 'tab-go', language: 'go', filePath: '/project/main.go' };
    useDocumentSymbolsMock.mockReturnValue({ status: 'unsupported', entries: [] });
    render(<GoToSymbol onClose={vi.fn()} />);
    expect(
      screen.getByText(
        'Symbol navigation is only available for JavaScript and TypeScript files.'
      )
    ).toBeTruthy();
  });

  it('lists the flattened symbols with their qualifiers', () => {
    useDocumentSymbolsMock.mockReturnValue({
      status: 'ready',
      entries: [
        {
          name: 'renderTree',
          qualifiedName: 'FileTree.renderTree',
          kind: 'method',
          line: 12,
          column: 3,
        },
        {
          name: 'openFile',
          qualifiedName: 'openFile',
          kind: 'function',
          line: 30,
          column: 1,
        },
      ],
    });

    render(<GoToSymbol onClose={vi.fn()} />);
    expect(screen.getByText('renderTree')).toBeTruthy();
    expect(screen.getByText('FileTree.renderTree')).toBeTruthy();
    expect(screen.getByText('openFile')).toBeTruthy();
    expect(screen.getByText('12:3')).toBeTruthy();
    expect(screen.getByText('30:1')).toBeTruthy();

    // accessibility pass — the symbol count is a polite live region.
    const count = screen.getByTestId('go-to-symbol-result-count');
    expect(count.getAttribute('role')).toBe('status');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(count.getAttribute('aria-atomic')).toBe('true');
  });

  it('queues a tabId-scoped reveal on select and closes the overlay', async () => {
    useDocumentSymbolsMock.mockReturnValue({
      status: 'ready',
      entries: [
        {
          name: 'renderTree',
          qualifiedName: 'FileTree.renderTree',
          kind: 'method',
          line: 12,
          column: 3,
        },
      ],
    });

    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GoToSymbol onClose={onClose} />);

    await user.click(screen.getByText('renderTree'));

    expect(mockRequestReveal).toHaveBeenCalledWith({
      tabId: 'tab-1',
      line: 12,
      column: 3,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('filters the list via the query input (case-insensitive)', async () => {
    useDocumentSymbolsMock.mockReturnValue({
      status: 'ready',
      entries: [
        { name: 'alpha', qualifiedName: 'alpha', kind: 'function', line: 1, column: 1 },
        { name: 'beta', qualifiedName: 'beta', kind: 'function', line: 2, column: 1 },
      ],
    });

    const user = userEvent.setup();
    render(<GoToSymbol onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Jump to symbol in this file...'), 'AL');

    await waitFor(() => {
      expect(screen.queryByText('beta')).toBeNull();
      expect(screen.getByText('alpha')).toBeTruthy();
    });
  });

  it('shows the loading copy instead of a stale list while symbols refresh', () => {
    // The hook clears entries when the tab changes so the overlay surfaces
    // "Loading symbols..." rather than the previous file's list. This
    // reproduces that contract at the component layer.
    useDocumentSymbolsMock.mockReturnValue({ status: 'loading', entries: [] });
    render(<GoToSymbol onClose={vi.fn()} />);
    expect(screen.getByText('Loading symbols...')).toBeTruthy();
  });

  it('keeps keyboard navigation stable after an empty result set', async () => {
    useDocumentSymbolsMock.mockReturnValue({
      status: 'ready',
      entries: [
        { name: 'alpha', qualifiedName: 'alpha', kind: 'function', line: 1, column: 1 },
      ],
    });

    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GoToSymbol onClose={onClose} />);
    const input = screen.getByPlaceholderText('Jump to symbol in this file...');

    await user.type(input, 'zzz');
    await user.keyboard('{ArrowDown}');
    await user.clear(input);
    await user.keyboard('{Enter}');

    expect(mockRequestReveal).toHaveBeenCalledWith({
      tabId: 'tab-1',
      line: 1,
      column: 1,
    });
    expect(onClose).toHaveBeenCalled();
  });
});
