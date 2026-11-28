import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverflowMenu, type OverflowMenuItem } from '../../src/renderer/components/ui/OverflowMenu';

function Menu({ actions }: { actions: OverflowMenuItem[] }) {
  return <OverflowMenu label="More project actions" testId="file-tree-more" itemTestIdPrefix="file-tree" items={actions} />;
}

describe('OverflowMenu', () => {
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
    render(<Menu actions={items} />);
    const user = userEvent.setup();
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More project actions' }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Refresh', 'Export project as zip']);
    expect(document.activeElement).toBe(screen.getByTestId('file-tree-refresh'));
    expect(screen.getByTestId('file-tree-more-menu')).toBe(screen.getByRole('menu'));

    await user.click(screen.getByTestId('file-tree-export-project'));
    expect(items[1]!.run).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves with the arrow keys and closes on Escape or a click outside', async () => {
    render(<Menu actions={actions()} />);
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

    await user.click(trigger);
    await user.keyboard('{End}');
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays inside the space left of its trigger on a narrow sidebar', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ right: 150 } as DOMRect);
    render(<Menu actions={actions()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'More project actions' }));
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.maxWidth).toBe('142px');
    expect(menu.style.minWidth).toBe('142px');
    rect.mockRestore();
  });

  it('reports a checked row without running it and marks the trigger for attention', async () => {
    const run = vi.fn();
    render(
      <OverflowMenu
        label="More dock actions"
        testId="dock-more"
        attention
        items={[
          { id: 'auto-log', label: 'Auto-log', icon: null, checked: true },
          { id: 'share', label: 'Share', icon: null, tone: 'warning', run },
        ]}
      />
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'More dock actions' });
    expect(trigger.querySelector('.bg-warning')).not.toBeNull();
    await user.click(trigger);
    const checked = screen.getByRole('menuitemcheckbox', { name: 'Auto-log' });
    expect(checked.getAttribute('aria-checked')).toBe('true');
    expect(checked.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(checked);
    await user.click(checked);
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(screen.getByTestId('dock-more-share').classList.contains('text-warning')).toBe(true);
  });
});
