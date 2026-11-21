import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBarSlot, CommandBarVerb } from '../../../src/renderer/components/Chrome/CommandBarSlot';
import { CommandBarSlotHost } from '../../../src/renderer/components/Chrome/CommandBarSlotHost';
import { CommandBarSlotScope } from '../../../src/renderer/components/Chrome/commandBarSlotScope';
import { useCommandBarSlotStore } from '../../../src/renderer/stores/commandBarSlotStore';
import { usePresenterModeStore } from '../../../src/renderer/stores/presenterModeStore';

afterEach(() => {
  act(() => usePresenterModeStore.setState({ active: false }));
});

const inHost = (testId: string) => screen.getByTestId('command-bar-verb').parentElement?.querySelector(`[data-testid="${testId}"]`);

describe('CommandBarSlot', () => {
  it('stays inline when no bar is mounted', () => {
    render(
      <section data-testid="surface">
        <CommandBarSlot slot="verb">
          <button type="button" data-testid="verb">Run</button>
        </CommandBarSlot>
      </section>
    );
    expect(screen.getByTestId('surface').contains(screen.getByTestId('verb'))).toBe(true);
  });

  it('portals into the bar and gives the slot to the highest, then latest, claim', () => {
    const { rerender } = render(
      <>
        <header><CommandBarSlotHost slot="verb" /></header>
        <main>
          <CommandBarSlot slot="verb"><span data-testid="first" /></CommandBarSlot>
        </main>
      </>
    );
    expect(inHost('first')).toBeTruthy();

    rerender(
      <>
        <header><CommandBarSlotHost slot="verb" /></header>
        <main>
          <CommandBarSlot slot="verb"><span data-testid="first" /></CommandBarSlot>
          <CommandBarSlot slot="verb"><span data-testid="second" /></CommandBarSlot>
          <CommandBarSlot slot="verb" priority={-1}><span data-testid="low" /></CommandBarSlot>
        </main>
      </>
    );
    expect(screen.queryByTestId('first')).toBeNull();
    expect(screen.queryByTestId('low')).toBeNull();
    expect(inHost('second')).toBeTruthy();

    rerender(
      <>
        <header><CommandBarSlotHost slot="verb" /></header>
        <main>
          <CommandBarSlot slot="verb"><span data-testid="first" /></CommandBarSlot>
        </main>
      </>
    );
    expect(inHost('first')).toBeTruthy();
  });

  it('releases its claim on unmount and while its scope is off', () => {
    const { rerender, unmount } = render(
      <>
        <CommandBarSlotHost slot="context" />
        <CommandBarSlotScope value="off">
          <CommandBarSlot slot="context"><span data-testid="chip" /></CommandBarSlot>
        </CommandBarSlotScope>
      </>
    );
    expect(useCommandBarSlotStore.getState().claims.context).toHaveLength(0);
    expect(screen.queryByTestId('chip')).toBeNull();
    rerender(
      <>
        <CommandBarSlotHost slot="context" />
        <CommandBarSlot slot="context"><span data-testid="chip" /></CommandBarSlot>
      </>
    );
    expect(useCommandBarSlotStore.getState().claims.context).toHaveLength(1);
    unmount();
    expect(useCommandBarSlotStore.getState().claims.context).toHaveLength(0);
    expect(useCommandBarSlotStore.getState().hosts.context).toBeNull();
  });

  it('drops the controls in presenter mode', () => {
    act(() => usePresenterModeStore.setState({ active: true }));
    render(<CommandBarSlot slot="verb"><span data-testid="verb" /></CommandBarSlot>);
    expect(screen.queryByTestId('verb')).toBeNull();
  });

  it('renders inline under a modal scope and nothing under an off scope, without claiming', () => {
    render(
      <>
        <CommandBarSlotHost slot="verb" />
        <CommandBarSlotScope value="inline">
          <div data-testid="modal">
            <CommandBarSlot slot="verb"><span data-testid="modal-verb" /></CommandBarSlot>
          </div>
        </CommandBarSlotScope>
        <CommandBarSlotScope value="off">
          <CommandBarSlot slot="verb"><span data-testid="hidden-verb" /></CommandBarSlot>
        </CommandBarSlotScope>
      </>
    );
    expect(screen.getByTestId('modal').contains(screen.getByTestId('modal-verb'))).toBe(true);
    expect(screen.queryByTestId('hidden-verb')).toBeNull();
    expect(useCommandBarSlotStore.getState().claims.verb).toHaveLength(0);
  });
});

describe('CommandBarVerb', () => {
  const menu = (onSelect = vi.fn()) => ({
    label: 'More run options',
    testId: 'verb-menu',
    listTestId: 'verb-menu-list',
    items: [
      { id: 'all', label: 'Run all', shortcut: '⇧⌘↵', testId: 'verb-all', onSelect },
      { id: 'off', label: 'Unavailable', disabled: true, testId: 'verb-off', onSelect },
    ],
  });

  it('fires the verb and the menu entries, and closes the menu on Escape', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSelect = vi.fn();
    render(<CommandBarVerb label="Run statement" icon={null} shortcut="⌘↵" onClick={onClick} testId="verb" menu={menu(onSelect)} />);
    const verb = screen.getByTestId('verb');
    expect(verb.getAttribute('aria-label')).toBe('Run statement');
    expect(verb.textContent).toContain('⌘↵');
    await user.click(verb);
    expect(onClick).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('verb-menu'));
    expect(screen.getByTestId('verb-menu').getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByTestId('verb-off') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId('verb-all'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('verb-menu-list')).toBeNull();

    await user.click(screen.getByTestId('verb-menu'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('verb-menu-list')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('verb-menu'));
  });

  it('hides the split menu while running and pulses', () => {
    render(<CommandBarVerb running label="Cancel" icon={null} onClick={vi.fn()} testId="verb" menu={menu()} />);
    expect(screen.getByTestId('verb').getAttribute('data-running')).toBe('true');
    expect(screen.queryByTestId('verb-menu')).toBeNull();
  });
});
