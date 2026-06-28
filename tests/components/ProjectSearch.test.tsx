import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProjectSearchStore } from '../../src/renderer/stores/projectSearchStore';
import { useAnnouncerStore } from '../../src/renderer/stores/announcerStore';

const mockOpenFile = vi.fn().mockResolvedValue(undefined);
const mockRequestReveal = vi.fn();
const mockClearPendingReveal = vi.fn();
const mockSearchInFiles = vi.fn();

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      openFile: mockOpenFile,
      requestReveal: mockRequestReveal,
      clearPendingReveal: mockClearPendingReveal,
      pendingReveal: null,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/renderer/stores/projectStore', () => ({
  useProjectStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      currentProject: {
        id: 'proj',
        name: 'project',
        rootId: 'root-proj',
        rootPath: '/project',
        lastOpenedAt: 0,
      },
    };
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
    mockRequestReveal.mockClear();
    mockClearPendingReveal.mockClear();
    mockSearchInFiles.mockReset();
    useProjectSearchStore.setState({
      query: '',
      rootId: null,
      resultsQuery: '',
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
    // UX Sweep T1 — the bespoke match-row button carries the focus ring.
    // (The file-group header also has data-row-key, so target the button.)
    const matchRow = document.querySelector('button[data-row-key]');
    expect(matchRow).not.toBeNull();
    expect(matchRow!.className).toContain('focus-ring');
  });

  it('announces the settled result count to screen readers (UX Sweep T13)', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
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
    useAnnouncerStore.setState({ message: '', nonce: 0 });

    const user = userEvent.setup();
    render(<ProjectSearch onClose={vi.fn()} />);
    await user.type(
      screen.getByPlaceholderText('Search across the project...'),
      'needle'
    );

    await waitFor(() => {
      expect(useAnnouncerStore.getState().message).toContain('1 match in 1 file');
    });
  });

  it('does not re-announce stale results while a new query is debouncing', async () => {
    mockSearchInFiles
      .mockResolvedValueOnce([
        {
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
      ])
      .mockImplementationOnce(() => new Promise(() => undefined));
    useAnnouncerStore.setState({ message: '', nonce: 0 });

    const user = userEvent.setup();
    render(<ProjectSearch onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Search across the project...');
    await user.type(input, 'needle');

    await waitFor(() => {
      expect(useAnnouncerStore.getState().message).toContain('1 match in 1 file');
    });
    const settledNonce = useAnnouncerStore.getState().nonce;

    await user.type(input, 'x');

    expect(useProjectSearchStore.getState().query).toBe('needlex');
    expect(useAnnouncerStore.getState().nonce).toBe(settledNonce);
  });

  it('announces the no-match state to screen readers (UX Sweep T13)', async () => {
    mockSearchInFiles.mockResolvedValue([]);
    useAnnouncerStore.setState({ message: '', nonce: 0 });

    const user = userEvent.setup();
    render(<ProjectSearch onClose={vi.fn()} />);
    await user.type(
      screen.getByPlaceholderText('Search across the project...'),
      'zzz'
    );

    await waitFor(() => {
      expect(useAnnouncerStore.getState().message).toContain('No matches for "zzz"');
    });
  });

  it('opens the target file when a match is clicked and closes the overlay', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
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
      'root-proj',
      'src/main.ts',
      'main.ts',
      'typescript',
      '/project/src/main.ts'
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to plaintext for files with no detectable language', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
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
    expect(mockOpenFile).toHaveBeenCalledWith(
      'root-proj',
      'NOTES',
      'NOTES',
      'plaintext',
      '/project/NOTES'
    );
  });

  it('queues an editor reveal before opening so the cursor lands on the match', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
        relativePath: 'src/main.ts',
        matches: [
          { line: 42, column: 7, preview: 'hello', matchStart: 0, matchEnd: 5 },
        ],
      },
    ]);

    const user = userEvent.setup();
    render(<ProjectSearch onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search across the project...');
    await user.type(input, 'hello');

    await waitFor(() => {
      expect(screen.getByText('42:7')).toBeTruthy();
    });

    await user.click(screen.getByText('42:7'));

    expect(mockRequestReveal).toHaveBeenCalledWith({
      filePath: '/project/src/main.ts',
      line: 42,
      column: 7,
    });
    // The reveal MUST be queued before openFile fires so the CodeEditor
    // effect has the target ready when the model becomes active.
    expect(mockRequestReveal.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpenFile.mock.invocationCallOrder[0]!
    );
  });

  it('clears the pending reveal if opening the file fails', async () => {
    mockOpenFile.mockRejectedValueOnce(new Error('read failed'));
    mockSearchInFiles.mockResolvedValue([
      {
        relativePath: 'src/main.ts',
        matches: [
          { line: 9, column: 2, preview: 'needle', matchStart: 0, matchEnd: 6 },
        ],
      },
    ]);

    const user = userEvent.setup();
    render(<ProjectSearch onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search across the project...');
    await user.type(input, 'needle');

    await waitFor(() => {
      expect(screen.getByText('9:2')).toBeTruthy();
    });

    await user.click(screen.getByText('9:2'));

    expect(mockRequestReveal).toHaveBeenCalled();
    expect(mockClearPendingReveal).toHaveBeenCalledOnce();
  });

  it('clears the global search state when the overlay unmounts', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
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
