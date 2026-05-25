import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { useProjectReplaceStore } from '../../src/renderer/stores/projectReplaceStore';

const mockSetActiveTab = vi.fn();
const mockSetTabContentFromDisk = vi.fn();
const mockReplaceInFiles = vi.fn();
const mockApplyReplaceInFile = vi.fn();
const mockRead = vi.fn();
const mockTrackEvent = vi.fn();
const mockPushStatusNotice = vi.fn();
let mockTabs: Array<{
  id: string;
  filePath?: string;
  isDirty: boolean;
}> = [];

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      tabs: mockTabs,
      setActiveTab: mockSetActiveTab,
      setTabContentFromDisk: mockSetTabContentFromDisk,
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

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      pushStatusNotice: mockPushStatusNotice,
    }),
  },
}));

vi.mock('lucide-react', () => ({
  Search: () => <span>search</span>,
  X: () => <span>x</span>,
  RotateCcw: () => <span>rotate</span>,
}));

import { ProjectReplace } from '../../src/renderer/components/ProjectReplace/ProjectReplace';

type LinguaTestWindow = typeof window & {
  lingua?: {
    fs?: {
      replaceInFiles?: typeof mockReplaceInFiles;
      applyReplaceInFile?: typeof mockApplyReplaceInFile;
      read?: typeof mockRead;
    };
  };
};

function previewMatch(line: number, column: number) {
  return {
    line,
    column,
    preview: 'const oldName = 1;',
    matchStart: 6,
    matchEnd: 13,
    replacedPreview: 'const newName = 1;',
    replacement: 'newName',
  };
}

describe('ProjectReplace', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    mockTabs = [];
    mockSetActiveTab.mockClear();
    mockSetTabContentFromDisk.mockClear();
    mockReplaceInFiles.mockReset();
    mockApplyReplaceInFile.mockReset();
    mockRead.mockReset();
    mockTrackEvent.mockClear();
    mockPushStatusNotice.mockClear();
    useProjectReplaceStore.setState({
      query: '',
      replacement: '',
      regex: false,
      caseSensitive: false,
      rootId: null,
      status: 'idle',
      results: [],
      totalMatches: 0,
      error: null,
      requestId: 0,
      applying: new Set<string>(),
      applyProgress: null,
    });
    (window as LinguaTestWindow).lingua = {
      fs: {
        replaceInFiles: mockReplaceInFiles,
        applyReplaceInFile: mockApplyReplaceInFile,
        read: mockRead,
      },
    };
  });

  it('renders the empty prompt when the query is blank', () => {
    render(<ProjectReplace onClose={vi.fn()} />);
    expect(
      screen.getByText('Type a query to preview replacements.')
    ).toBeTruthy();
  });

  it('renders the excludes chips in the header (fold F)', () => {
    render(<ProjectReplace onClose={vi.fn()} />);
    const chips = screen.getByTestId('project-replace-excludes-chips');
    expect(chips.textContent).toContain('node_modules');
    expect(chips.textContent).toContain('.git');
    expect(chips.textContent).toContain('dist');
    expect(chips.textContent).toContain('build');
  });

  it('previews matches grouped by file with a before/after diff', async () => {
    mockReplaceInFiles.mockResolvedValue([
      {
        relativePath: 'src/main.ts',
        matches: [previewMatch(7, 7)],
      },
    ]);

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );
    await user.type(
      screen.getByTestId('project-replace-replacement-input'),
      'newName'
    );

    await waitFor(() => {
      expect(screen.getByText('src/main.ts')).toBeTruthy();
    });
    // The "Apply to file" button + apply-to-all footer are visible.
    expect(
      screen.getByTestId('project-replace-apply-file-src/main.ts')
    ).toBeTruthy();
    expect(screen.getByTestId('project-replace-apply-all')).toBeTruthy();
  });

  it('shows a confirmation modal before applying to all', async () => {
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: [previewMatch(1, 1)] },
      { relativePath: 'b.ts', matches: [previewMatch(1, 1)] },
    ]);
    mockApplyReplaceInFile.mockResolvedValue({ ok: true, replaced: 1 });

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-replace-apply-all')).toBeTruthy();
    });

    await user.click(screen.getByTestId('project-replace-apply-all'));
    expect(screen.getByTestId('project-replace-confirm')).toBeTruthy();

    await user.click(screen.getByTestId('project-replace-confirm-apply'));

    await waitFor(() => {
      expect(mockApplyReplaceInFile).toHaveBeenCalledTimes(2);
    });
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'editor.replace_in_files_applied',
      expect.objectContaining({ scope: 'all-files', regex: false })
    );
  });

  it('cancels the all-files apply when the modal is dismissed', async () => {
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: [previewMatch(1, 1)] },
    ]);

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-replace-apply-all')).toBeTruthy();
    });

    await user.click(screen.getByTestId('project-replace-apply-all'));
    await user.click(screen.getByTestId('project-replace-confirm-cancel'));

    expect(mockApplyReplaceInFile).not.toHaveBeenCalled();
  });

  it('per-file apply fires telemetry with single-file scope', async () => {
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'src/main.ts', matches: [previewMatch(1, 1)] },
    ]);
    mockApplyReplaceInFile.mockResolvedValue({ ok: true, replaced: 1 });

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('project-replace-apply-file-src/main.ts')
      ).toBeTruthy();
    });

    await user.click(
      screen.getByTestId('project-replace-apply-file-src/main.ts')
    );

    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'editor.replace_in_files_applied',
        expect.objectContaining({ scope: 'single-file', regex: false })
      );
    });
  });

  it('blocks per-file apply when the matching open tab is dirty', async () => {
    mockTabs = [
      {
        id: 'tab-main',
        filePath: '/project/src/main.ts',
        isDirty: true,
      },
    ];
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'src/main.ts', matches: [previewMatch(1, 1)] },
    ]);

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('project-replace-apply-file-src/main.ts')
      ).toBeTruthy();
    });
    await user.click(
      screen.getByTestId('project-replace-apply-file-src/main.ts')
    );

    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-main');
    expect(mockApplyReplaceInFile).not.toHaveBeenCalled();
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'warning',
        messageKey: 'projectReplace.dirtyOpenTab',
        values: { path: 'src/main.ts' },
      })
    );
  });

  it('reloads clean open tabs from disk after apply-to-all succeeds', async () => {
    mockTabs = [
      {
        id: 'tab-a',
        filePath: '/project/a.ts',
        isDirty: false,
      },
    ];
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: [previewMatch(1, 1)] },
      { relativePath: 'b.ts', matches: [previewMatch(1, 1)] },
    ]);
    mockApplyReplaceInFile.mockResolvedValue({ ok: true, replaced: 1 });
    mockRead.mockResolvedValue('const newName = 1;\n');

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-replace-apply-all')).toBeTruthy();
    });
    await user.click(screen.getByTestId('project-replace-apply-all'));
    await user.click(screen.getByTestId('project-replace-confirm-apply'));

    await waitFor(() => {
      expect(mockSetTabContentFromDisk).toHaveBeenCalledWith(
        'tab-a',
        'const newName = 1;\n'
      );
    });
    expect(mockRead).toHaveBeenCalledWith('root-proj', 'a.ts');
  });

  it('blocks apply-to-all when any eligible open tab is dirty', async () => {
    mockTabs = [
      {
        id: 'tab-a',
        filePath: '/project/a.ts',
        isDirty: true,
      },
    ];
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: [previewMatch(1, 1)] },
      { relativePath: 'b.ts', matches: [previewMatch(1, 1)] },
    ]);

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-replace-apply-all')).toBeTruthy();
    });
    await user.click(screen.getByTestId('project-replace-apply-all'));
    await user.click(screen.getByTestId('project-replace-confirm-apply'));

    expect(mockApplyReplaceInFile).not.toHaveBeenCalled();
    expect(mockPushStatusNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: 'projectReplace.dirtyOpenTab',
        values: { path: 'a.ts' },
      })
    );
  });

  it('renders a regex-timed-out notice when a file is flagged (fold C)', async () => {
    mockReplaceInFiles.mockResolvedValue([
      {
        relativePath: 'slow.ts',
        matches: [],
        regexTimedOut: true,
      },
    ]);

    const user = userEvent.setup();
    render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      '.*.*'
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('project-replace-row-slow.ts').textContent
      ).toContain('slow.ts');
    });
  });

  it('renders the progress strip when apply-to-all is running (fold A)', async () => {
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: [previewMatch(1, 1)] },
    ]);
    useProjectReplaceStore.setState({
      applyProgress: { done: 0, total: 5 },
    });

    render(<ProjectReplace onClose={vi.fn()} />);
    expect(screen.getByTestId('project-replace-progress')).toBeTruthy();
    expect(
      screen.getByTestId('project-replace-progress').textContent
    ).toContain('0');
    expect(
      screen.getByTestId('project-replace-progress').textContent
    ).toContain('5');
  });

  it('localizes the overlay in Spanish (tuteo)', async () => {
    const previous = i18next.language;
    await i18next.changeLanguage('es');
    try {
      render(<ProjectReplace onClose={vi.fn()} />);
      expect(
        screen.getByPlaceholderText('Busca…')
      ).toBeTruthy();
      expect(
        screen.getByPlaceholderText('Reemplaza con…')
      ).toBeTruthy();
      expect(
        screen.getByTestId('project-replace-excludes-chips').textContent
      ).toContain('node_modules');
    } finally {
      await i18next.changeLanguage(previous);
    }
  });

  it('clears the replace state on unmount', async () => {
    mockReplaceInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: [previewMatch(1, 1)] },
    ]);

    const user = userEvent.setup();
    const { unmount } = render(<ProjectReplace onClose={vi.fn()} />);
    await user.type(
      screen.getByTestId('project-replace-find-input'),
      'oldName'
    );
    await waitFor(() => {
      expect(useProjectReplaceStore.getState().query).toBe('oldName');
    });

    act(() => {
      unmount();
    });
    const state = useProjectReplaceStore.getState();
    expect(state.query).toBe('');
    expect(state.results).toEqual([]);
  });
});
