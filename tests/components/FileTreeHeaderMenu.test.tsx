import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTreeHeaderMenu } from '../../src/renderer/components/FileTree/FileTreeHeaderMenu';

describe('FileTreeHeaderMenu', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });
  afterEach(cleanup);

  const actions = () => [
    { id: 'refresh', label: 'Refresh', icon: null, run: vi.fn() },
    { id: 'export-project', label: 'Export project as zip', icon: null, run: vi.fn() },
  ];

  it('opens on demand, runs an action and closes', async () => {
    const items = actions();
    render(<FileTreeHeaderMenu actions={items} />);
    const user = userEvent.setup();
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More project actions' }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Refresh', 'Export project as zip']);
    expect(document.activeElement).toBe(screen.getByTestId('file-tree-refresh'));

    await user.click(screen.getByTestId('file-tree-export-project'));
    expect(items[1]!.run).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves with the arrow keys and closes on Escape or a click outside', async () => {
    render(<FileTreeHeaderMenu actions={actions()} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'More project actions' });

    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('file-tree-export-project'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
