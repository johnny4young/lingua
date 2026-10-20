import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import {
  SettingsSectionChips,
  activeSectionIndex,
} from '@/components/Settings/SettingsSectionChips';

function Harness({ labels }: { labels: string[] }) {
  const panelRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <SettingsSectionChips panelRef={panelRef} tabKey="editor" tabLabel="Editor" />
      <div ref={panelRef} data-testid="panel">
        {labels.map(label => (
          <section key={label} data-settings-chip={label}>
            {label}
          </section>
        ))}
      </div>
    </>
  );
}

const rect = (top: number) => ({ top }) as DOMRect;

describe('Settings section chips', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('lists one chip per section and stays hidden for a single section', () => {
    render(<Harness labels={['Editor', 'Per-language', 'SQL workspace']} />);
    const chips = screen.getAllByTestId('settings-section-chip');
    expect(chips.map(chip => chip.textContent)).toEqual([
      'Editor',
      'Per-language',
      'SQL workspace',
    ]);
    expect(chips[0]?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('navigation', { name: 'Sections in Editor' })).toBeTruthy();
    cleanup();

    render(<Harness labels={['Environment']} />);
    expect(screen.queryByTestId('settings-section-chips')).toBeNull();
  });

  it('scrolls the panel, not the sheet, to the picked section and presses its chip', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<Harness labels={['Editor', 'Per-language', 'SQL workspace']} />);
      const panel = screen.getByTestId('panel');
      const scrollTo = vi.fn();
      panel.scrollTo = scrollTo as typeof panel.scrollTo;
      Object.defineProperty(panel, 'scrollTop', { configurable: true, value: 100 });
      panel.getBoundingClientRect = () => rect(50);
      panel.querySelectorAll('section')[2]!.getBoundingClientRect = () => rect(650);

      fireEvent.click(screen.getByRole('button', { name: 'SQL workspace' }));
      // 650 - 50 + 100, less the 16 px gap above the section.
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 684 }));
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'SQL workspace' }).getAttribute('aria-current')
      ).toBe('true');
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('follows the scroll: the last section whose top passed the panel top wins', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      render(<Harness labels={['Editor', 'Per-language', 'SQL workspace']} />);
      const panel = screen.getByTestId('panel');
      const sections = [...panel.querySelectorAll('section')];
      Object.defineProperties(panel, {
        scrollTop: { configurable: true, value: 400 },
        clientHeight: { configurable: true, value: 500 },
        scrollHeight: { configurable: true, value: 2000 },
      });
      panel.getBoundingClientRect = () => rect(100);
      [-300, 110, 700].forEach((top, index) => {
        sections[index]!.getBoundingClientRect = () => rect(top);
      });

      fireEvent.scroll(panel);
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(
        screen.getByRole('button', { name: 'Per-language' }).getAttribute('aria-current')
      ).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks the first section at the top and the last one at the bottom', () => {
    const element = (top: number) => ({ getBoundingClientRect: () => rect(top) }) as HTMLElement;
    const sections = [
      { label: 'A', element: element(0) },
      { label: 'B', element: element(900) },
    ];
    const panel = (scrollTop: number) =>
      ({
        scrollTop,
        clientHeight: 500,
        scrollHeight: 1000,
        getBoundingClientRect: () => rect(0),
      }) as unknown as HTMLElement;

    expect(activeSectionIndex(panel(0), sections)).toBe(0);
    expect(activeSectionIndex(panel(200), sections)).toBe(0);
    expect(activeSectionIndex(panel(500), sections)).toBe(1);
  });
});
