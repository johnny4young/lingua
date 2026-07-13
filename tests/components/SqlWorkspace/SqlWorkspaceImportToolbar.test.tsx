import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SqlWorkspaceImportToolbar } from '../../../src/renderer/components/SqlWorkspace/SqlWorkspaceImportToolbar';
import { SQL_IMPORT_FILE_ACCEPT } from '../../../src/shared/sqlWorkspace';

describe('SqlWorkspaceImportToolbar', () => {
  it('opens the accepted-file picker from its keyboard-operable button', async () => {
    const user = userEvent.setup();
    render(
      <SqlWorkspaceImportToolbar
        isBusy={false}
        isPreviewing={false}
        onImportFile={vi.fn()}
      />
    );

    const input = screen.getByTestId(
      'sql-workspace-import-input'
    ) as HTMLInputElement;
    const inputClick = vi.spyOn(input, 'click');

    await user.click(screen.getByTestId('sql-workspace-import'));

    expect(inputClick).toHaveBeenCalledOnce();
    expect(input.accept).toBe(SQL_IMPORT_FILE_ACCEPT);
  });

  it('forwards the selected file and resets the native input', async () => {
    const user = userEvent.setup();
    const onImportFile = vi.fn();
    render(
      <SqlWorkspaceImportToolbar
        isBusy={false}
        isPreviewing={false}
        onImportFile={onImportFile}
      />
    );
    const input = screen.getByTestId(
      'sql-workspace-import-input'
    ) as HTMLInputElement;
    const file = new File(['id,name\n1,Lingua\n'], 'sample.csv', {
      type: 'text/csv',
    });

    await user.upload(input, file);

    expect(onImportFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('disables both controls while import work is busy', () => {
    render(
      <SqlWorkspaceImportToolbar
        isBusy
        isPreviewing
        onImportFile={vi.fn()}
      />
    );

    expect(
      (screen.getByTestId('sql-workspace-import') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId('sql-workspace-import-input') as HTMLInputElement)
        .disabled
    ).toBe(true);
  });
});
