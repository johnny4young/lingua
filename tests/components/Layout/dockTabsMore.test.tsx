import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { DockTabsMore } from '@/components/Layout/DockTabsMore';
import type { DockTabId } from '@/components/Layout/dockTabs';
import { rankDockTabs, readDockTabUse, recordDockTabUse } from '@/components/Layout/dockTabUse';
import { useDockRowFit } from '@/components/Layout/useDockRowFit';

const WIDTH: Partial<Record<DockTabId, number>> = { console: 90, stdin: 60, compare: 100, variables: 110 };
const ORDER: DockTabId[] = ['console', 'stdin', 'compare', 'variables'];

function Row({ width, ranked, pinned }: { width: number; ranked: DockTabId[]; pinned: DockTabId[] }) {
  const row = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const overflow = useDockRowFit(row, list, controls, more, false, ranked, pinned);
  return (
    <div ref={row} data-testid="row" data-client-width={width}>
      <div ref={list}>
        {ORDER.map(id => (
          <button key={id} type="button" data-dock-tab={id} data-width={WIDTH[id]} />
        ))}
      </div>
      <div ref={more} data-width={60} />
      <div ref={controls} data-width={80} />
      <output data-testid="overflow">{overflow.join(',')}</output>
    </div>
  );
}

describe('dock tab use', () => {
  beforeEach(() => window.localStorage.clear());

  it('ranks by use and keeps board order on ties', () => {
    expect(rankDockTabs(ORDER, {})).toEqual(ORDER);
    expect(rankDockTabs(ORDER, { variables: 3, compare: 3, stdin: 1 })).toEqual(['compare', 'variables', 'stdin', 'console']);
  });

  it('persists picks and reads malformed storage as unused', () => {
    const use = recordDockTabUse(recordDockTabUse({}, 'variables'), 'variables');
    expect(use).toEqual({ variables: 2 });
    expect(readDockTabUse()).toEqual({ variables: 2 });
    window.localStorage.setItem('lingua-ui:dock-tab-use', '{"variables":"9","stdin":-1,"compare":2.5,"tests":4}');
    expect(readDockTabUse()).toEqual({ tests: 4 });
    window.localStorage.setItem('lingua-ui:dock-tab-use', '[1]');
    expect(readDockTabUse()).toEqual({});
    window.localStorage.setItem('lingua-ui:dock-tab-use', '{');
    expect(readDockTabUse()).toEqual({});
  });
});

describe('useDockRowFit', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { width: Number(this.getAttribute('data-width') ?? 0) } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.clientWidth ?? 0);
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps every tab on a row that fits', () => {
    render(<Row width={1000} ranked={ORDER} pinned={['console']} />);
    expect(screen.getByTestId('overflow').textContent).toBe('');
    expect(screen.getByTestId('row').dataset.fit).toBe('full');
  });

  it('moves the least used tabs into More, which takes its own width', () => {
    // 400 - 80 controls - 60 More = 260 for tabs.
    const { rerender } = render(<Row width={400} ranked={ORDER} pinned={['console']} />);
    expect(screen.getByTestId('overflow').textContent).toBe('variables');
    expect(screen.getByTestId('row').dataset.fit).toBe('tight');

    rerender(<Row width={400} ranked={['console', 'variables', 'stdin', 'compare']} pinned={['console']} />);
    expect(screen.getByTestId('overflow').textContent).toBe('compare');
  });

  it('never moves a pinned tab, and stops at the first used tab that does not fit', () => {
    render(<Row width={400} ranked={['console', 'variables', 'stdin', 'compare']} pinned={['console', 'compare']} />);
    // 260 - 90 - 100 = 70: variables (110) does not fit, so stdin follows it into More.
    expect(screen.getByTestId('overflow').textContent).toBe('variables,stdin');
  });
});

describe('DockTabsMore', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(cleanup);

  it('stays measurable and out of reach with nothing to hold', () => {
    render(<DockTabsMore rows={[]} alert={false} onPick={() => {}} />);
    const trigger = screen.getByTestId('dock-tabs-more');
    expect(trigger.parentElement?.dataset.idle).toBe('true');
    expect(trigger.tabIndex).toBe(-1);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists each tab with its badge and shortcut, and hands back the picked one', () => {
    const onPick = vi.fn();
    render(
      <DockTabsMore
        rows={[
          { id: 'tests', icon: null, label: 'Tests', hint: 'Run tests', badges: <span data-testid="badge">2</span>, shortcut: null },
          { id: 'variables', icon: null, label: 'Variables', hint: 'Inspect', badges: null, shortcut: '⌘⇧I' },
        ]}
        alert
        onPick={onPick}
      />
    );
    expect(screen.queryByTestId('dock-tabs-more-alert')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More tabs' }));
    const menu = screen.getByRole('menu', { name: 'More tabs' });
    expect(menu.textContent).toContain('Tests2');
    expect(screen.getByTestId('dock-tabs-more-variables').textContent).toContain('⌘⇧I');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Variables/ }));
    expect(onPick).toHaveBeenCalledWith('variables');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
