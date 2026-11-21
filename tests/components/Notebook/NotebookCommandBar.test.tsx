import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { NotebookCommandBar } from '../../../src/renderer/components/Notebook/NotebookCommandBar';
import type { NotebookCellV1 } from '../../../src/shared/notebook';

const cells = [
  { id: 'm1', kind: 'markdown', source: '# Notes' },
  { id: 'c1', kind: 'code', language: 'python', source: 'x = 1', outputs: [] },
] as unknown as NotebookCellV1[];

const handlers = () => ({
  onRunCell: vi.fn(),
  onRunAll: vi.fn(),
  onRunAbove: vi.fn(),
  onRunFromHere: vi.fn(),
  onStop: vi.fn(),
});

beforeEach(async () => {
  await initI18n();
});

describe('NotebookCommandBar', () => {
  it('names the active cell and its language and runs it', async () => {
    const user = userEvent.setup();
    const props = handlers();
    render(<NotebookCommandBar cells={cells} activeCellId="c1" isAnyCellRunning={false} canRunAll canRunAbove canRunFromHere {...props} />);
    expect(screen.getByTestId('notebook-command-bar-cell').textContent).toContain('Cell 2');
    expect(screen.getByTestId('notebook-command-bar-cell').textContent).toContain('Python');
    await user.click(screen.getByTestId('notebook-command-bar-run-cell'));
    expect(props.onRunCell).toHaveBeenCalledWith('c1');
    await user.click(screen.getByTestId('notebook-command-bar-run-menu'));
    await user.click(screen.getByTestId('notebook-command-bar-run-all'));
    expect(props.onRunAll).toHaveBeenCalledTimes(1);
  });

  it('cannot run a markdown cell, and offers Stop while a cell runs', async () => {
    const props = handlers();
    const { rerender } = render(<NotebookCommandBar cells={cells} activeCellId="m1" isAnyCellRunning={false} canRunAll canRunAbove={false} canRunFromHere {...props} />);
    expect((screen.getByTestId('notebook-command-bar-run-cell') as HTMLButtonElement).disabled).toBe(true);
    rerender(<NotebookCommandBar cells={cells} activeCellId="c1" isAnyCellRunning canRunAll canRunAbove canRunFromHere {...props} />);
    await userEvent.setup().click(screen.getByTestId('notebook-command-bar-stop'));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });
});
