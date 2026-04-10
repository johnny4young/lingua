import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTreeEmptyState } from '../../src/renderer/components/FileTree/FileTreeEmptyState';
import { FileTreeInlineInput } from '../../src/renderer/components/FileTree/FileTreeInlineInput';

vi.mock('lucide-react', () => ({
  FileCode: () => <span aria-hidden="true">file</span>,
  Folder: () => <span aria-hidden="true">folder</span>,
  FolderOpen: () => <span aria-hidden="true">open-folder</span>,
}));

describe('FileTreeInlineInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms a trimmed name on Enter', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <FileTreeInlineInput
        placeholder="filename.ts"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const input = screen.getByPlaceholderText('filename.ts');
    await user.type(input, '  app.ts  {enter}');

    expect(onConfirm).toHaveBeenCalledWith('app.ts');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels when the input is blank on blur', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <div>
        <FileTreeInlineInput
          placeholder="folder-name"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
        <button type="button">Outside</button>
      </div>
    );

    screen.getByPlaceholderText('folder-name');
    await user.click(screen.getByRole('button', { name: 'Outside' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('FileTreeEmptyState', () => {
  const baseProject = {
    id: 'project-1',
    name: 'demo-project',
    rootPath: '/tmp/demo-project',
    openedAt: 1,
  };

  it('surfaces recent projects and open tabs through explicit callbacks', async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const onOpenRecentProject = vi.fn();
    const onSelectTab = vi.fn();

    render(
      <FileTreeEmptyState
        recentProjects={[baseProject]}
        tabs={[
          {
            id: 'tab-1',
            name: 'main.ts',
            language: 'typescript',
            content: '',
            isDirty: true,
          },
        ]}
        activeTabId="tab-1"
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        onOpenRecentProject={onOpenRecentProject}
        onSelectTab={onSelectTab}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create Project' }));
    await user.click(screen.getByRole('button', { name: 'Open Folder' }));
    await user.click(screen.getByRole('button', { name: 'demo-project' }));
    await user.click(screen.getByRole('button', { name: 'main.ts' }));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onOpenProject).toHaveBeenCalledTimes(1);
    expect(onOpenRecentProject).toHaveBeenCalledWith(baseProject);
    expect(onSelectTab).toHaveBeenCalledWith('tab-1');
  });
});
