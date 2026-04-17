import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProjectSearchStore } from '../../src/renderer/stores/projectSearchStore';

const mockOpenFile = vi.fn().mockResolvedValue(undefined);
const mockSearchInFiles = vi.fn();

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) => {
    const state = { openFile: mockOpenFile };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/renderer/stores/projectStore', () => ({
  useProjectStore: (selector?: (state: unknown) => unknown) => {
    const state = { currentProject: { rootPath: '/project' } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('lucide-react', () => ({
  Search: () => <span>search</span>,
  X: () => <span>x</span>,
}));

import { ProjectSearch } from '../../src/renderer/components/ProjectSearch/ProjectSearch';

type LinguaTestWindow = typeof window & {
  lingua?: { fs?: { searchInFiles?: typeof mockSearchInFiles } };
};

describe('ProjectSearch', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    mockOpenFile.mockClear();
    mockSearchInFiles.mockReset();
    useProjectSearchStore.setState({
      query: '',
      rootPath: null,
      status: 'idle',
      results: [],
      totalMatches: 0,
      error: null,
      requestId: 0,
    });
    (window as LinguaTestWindow).lingua = {
      fs: { searchInFiles: mockSearchInFiles },
    };
  });

  it('renders the prompt when the query is empty', () => {
    render(<ProjectSearch onClose={vi.fn()} />);
    expect(
      screen.getByText('Start typing to search every file in the active project.')
    ).toBeTruthy();
  });

  it('groups results by file and renders highlighted previews', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
        filePath: '/project/src/main.ts',
        relativePath: 'src/main.ts',
        matches: [
          {
            line: 7,
            column: 3,
            preview: 'const needle = 1;',
            matchStart: 6,
            matchEnd: 12,
          },
        ],
      },
    ]);

    const user = userEvent.setup();
    render(<ProjectSearch onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search across the project...');
    await user.type(input, 'needle');

    await waitFor(() => {
      expect(screen.getByText('src/main.ts')).toBeTruthy();
    });
    expect(screen.getByText('7:3')).toBeTruthy();
    expect(screen.getByText('needle')).toBeTruthy();
  });

  it('opens the target file when a match is clicked and closes the overlay', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
        filePath: '/project/src/main.ts',
        relativePath: 'src/main.ts',
        matches: [
          {
            line: 1,
            column: 1,
            preview: 'hit here',
            matchStart: 0,
            matchEnd: 3,
          },
        ],
      },
    ]);

    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ProjectSearch onClose={onClose} />);

    const input = screen.getByPlaceholderText('Search across the project...');
    await user.type(input, 'hit');

    await waitFor(() => {
      expect(screen.getByText('1:1')).toBeTruthy();
    });

    await user.click(screen.getByText('1:1'));

    expect(mockOpenFile).toHaveBeenCalledWith(
      '/project/src/main.ts',
      'main.ts',
      'typescript'
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to plaintext for files with no detectable language', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
        filePath: '/project/NOTES',
        relativePath: 'NOTES',
        matches: [
          { line: 1, column: 1, preview: 'foo', matchStart: 0, matchEnd: 3 },
        ],
      },
    ]);

    const user = userEvent.setup();
    render(<ProjectSearch onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search across the project...');
    await user.type(input, 'foo');

    await waitFor(() => {
      expect(screen.getByText('NOTES')).toBeTruthy();
    });

    await user.click(screen.getByText('1:1'));
    expect(mockOpenFile).toHaveBeenCalledWith('/project/NOTES', 'NOTES', 'plaintext');
  });

  it('clears the global search state when the overlay unmounts', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
        filePath: '/project/src/main.ts',
        relativePath: 'src/main.ts',
        matches: [
          { line: 2, column: 1, preview: 'needle', matchStart: 0, matchEnd: 6 },
        ],
      },
    ]);

    const user = userEvent.setup();
    const rendered = render(<ProjectSearch onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search across the project...');
    await user.type(input, 'needle');

    await waitFor(() => {
      expect(useProjectSearchStore.getState().query).toBe('needle');
      expect(useProjectSearchStore.getState().results).toHaveLength(1);
    });

    rendered.unmount();

    const state = useProjectSearchStore.getState();
    expect(state.query).toBe('');
    expect(state.status).toBe('idle');
    expect(state.results).toEqual([]);
    expect(state.totalMatches).toBe(0);
  });
});
