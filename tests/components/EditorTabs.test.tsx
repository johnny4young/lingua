import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetActiveTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockCloseTab = vi.fn().mockResolvedValue(true);

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

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: () => ({
    tabs: mockTabs,
    activeTabId: 'tab-go',
    setActiveTab: mockSetActiveTab,
    removeTab: mockRemoveTab,
    closeTab: mockCloseTab,
  }),
}));

vi.mock('lucide-react', () => ({
  X: () => <span>x</span>,
}));

import { EditorTabs } from '../../src/renderer/components/Editor/EditorTabs';

describe('EditorTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an accessible tablist with selected state', () => {
    render(<EditorTabs />);

    expect(screen.getByRole('tablist', { name: 'Open files' })).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'JS untitled.js' }).getAttribute('aria-selected')
    ).toBe('false');
    expect(
      screen.getByRole('tab', { name: 'Go main.go' }).getAttribute('aria-selected')
    ).toBe('true');
  });

  it('exposes the unsaved marker with an accessible label', () => {
    render(<EditorTabs />);

    expect(screen.getByLabelText('untitled.js has unsaved changes')).toBeTruthy();
  });

  it('separates tab activation from the close action', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    await user.click(screen.getByRole('tab', { name: 'JS untitled.js' }));
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');

    await user.click(screen.getByRole('button', { name: 'Close untitled.js' }));
    expect(mockCloseTab).toHaveBeenCalledWith('tab-js');
  });

  it('activates a tab when clicking anywhere on the card, not only the label', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    // Click the padding area on the right side of the tab (between the
    // label and the close button). Before this fix only the label text
    // triggered activation — the surrounding rounded surface was dead
    // space.
    const tab = screen.getByRole('tab', { name: 'JS untitled.js' });
    await user.pointer({ target: tab, coords: { clientX: 1, clientY: 1 } });
    await user.click(tab);

    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');
  });

  it('activates a tab from the keyboard via Enter and Space', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    const tab = screen.getByRole('tab', { name: 'JS untitled.js' });
    tab.focus();

    await user.keyboard('{Enter}');
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');

    mockSetActiveTab.mockClear();
    await user.keyboard(' ');
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-js');
  });

  it('shows the tab filename in the shared tooltip layer', async () => {
    const user = userEvent.setup();
    render(<EditorTabs />);

    await user.hover(screen.getByRole('tab', { name: 'Go main.go' }));

    expect(screen.getByRole('tooltip').textContent).toContain('main.go');
  });
});
