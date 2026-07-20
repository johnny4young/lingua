import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SqlEmptyState } from '../../../src/renderer/components/SqlWorkspace/SqlEmptyState';
import { SQL_IMPORT_FILE_ACCEPT } from '../../../src/shared/sqlWorkspace';

describe('SqlEmptyState', () => {
  it('renders New query and Import data actions', () => {
    render(<SqlEmptyState onCreate={vi.fn()} onImportFile={vi.fn()} />);
    expect(screen.getByTestId('sql-workspace-empty-create')).toBeTruthy();
    expect(screen.getByTestId('sql-workspace-empty-import')).toBeTruthy();
  });

  it('invokes onCreate when New query is clicked', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<SqlEmptyState onCreate={onCreate} onImportFile={vi.fn()} />);

    await user.click(screen.getByTestId('sql-workspace-empty-create'));

    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('uses the shared focus-ring contract for both actions', () => {
    render(<SqlEmptyState onCreate={vi.fn()} onImportFile={vi.fn()} />);
    expect(screen.getByTestId('sql-workspace-empty-create').className).toContain(
      'focus-ring'
    );
    expect(screen.getByTestId('sql-workspace-empty-import').className).toContain(
      'focus-ring'
    );
  });

  it('opens the accepted-file picker from the Import data button', async () => {
    const user = userEvent.setup();
    render(<SqlEmptyState onCreate={vi.fn()} onImportFile={vi.fn()} />);
    const input = screen.getByTestId(
      'sql-workspace-empty-import-input'
    ) as HTMLInputElement;
    const inputClick = vi.spyOn(input, 'click');

    await user.click(screen.getByTestId('sql-workspace-empty-import'));

    expect(inputClick).toHaveBeenCalledOnce();
    expect(input.accept).toBe(SQL_IMPORT_FILE_ACCEPT);
  });

  it('forwards the selected file and resets the native input', async () => {
    const user = userEvent.setup();
    const onImportFile = vi.fn();
    render(<SqlEmptyState onCreate={vi.fn()} onImportFile={onImportFile} />);
    const input = screen.getByTestId(
      'sql-workspace-empty-import-input'
    ) as HTMLInputElement;
    const file = new File(['id,name\n1,Lingua\n'], 'sample.csv', {
      type: 'text/csv',
    });

    await user.upload(input, file);

    expect(onImportFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });
});
