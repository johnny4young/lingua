import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

interface SectionEntry {
  label: string;
  element: HTMLElement;
}

/** A section counts as current once its top reaches this far below the panel top. */
const ACTIVE_OFFSET_PX = 24;
/** Room left above a section the chips scroll to. */
const SECTION_GAP_PX = 16;

function collectSections(panel: HTMLElement): SectionEntry[] {
  return [...panel.querySelectorAll<HTMLElement>('[data-settings-chip]')].flatMap(element => {
    const label = element.dataset.settingsChip;
    return label ? [{ label, element }] : [];
  });
}

/** The current section: the last one whose top has scrolled past the offset. */
export function activeSectionIndex(panel: HTMLElement, sections: readonly SectionEntry[]): number {
  if (sections.length === 0 || panel.scrollTop <= 0) return 0;
  if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2) return sections.length - 1;
  const panelTop = panel.getBoundingClientRect().top;
  let index = 0;
  sections.forEach((section, at) => {
    if (section.element.getBoundingClientRect().top - panelTop <= ACTIVE_OFFSET_PX) index = at;
  });
  return index;
}

interface SettingsSectionChipsProps {
  panelRef: RefObject<HTMLDivElement | null>;
  /** Re-reads the sections when the tab changes. */
  tabKey: string;
  tabLabel: string;
}

/** Sticky jump chips for a tab with two or more sections; the pressed chip follows the scroll. */
export function SettingsSectionChips({ panelRef, tabKey, tabLabel }: SettingsSectionChipsProps) {
  const { t } = useTranslation();
  const [sections, setSections] = useState<SectionEntry[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const refresh = () => {
      const next = collectSections(panel);
      setSections(current =>
        current.length === next.length &&
        current.every(
          (entry, index) =>
            entry.element === next[index]?.element && entry.label === next[index]?.label
        )
          ? current
          : next
      );
    };
    refresh();
    setActive(0);
    // Sections can mount after the tab (lazy rows), so keep the list current.
    const observer = new MutationObserver(refresh);
    observer.observe(panel, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [panelRef, tabKey]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || sections.length < 2) return;
    let frame = 0;
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setActive(activeSectionIndex(panel, sections)));
    };
    panel.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      panel.removeEventListener('scroll', onScroll);
    };
  }, [panelRef, sections]);

  const jumpTo = useCallback(
    (index: number) => {
      const section = sections[index];
      const panel = panelRef.current;
      if (!section || !panel) return;
      setActive(index);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Scroll the panel only: scrollIntoView would also scroll the sheet and hide its top bar.
      const top =
        section.element.getBoundingClientRect().top -
        panel.getBoundingClientRect().top +
        panel.scrollTop;
      panel.scrollTo?.({
        top: Math.max(0, top - SECTION_GAP_PX),
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    },
    [panelRef, sections]
  );

  if (sections.length < 2) return null;

  return (
    <nav
      aria-label={t('settings.sections.label', { tab: tabLabel })}
      data-testid="settings-section-chips"
      className="settings-section-chips flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border-subtle bg-bg-base px-5"
    >
      {sections.map((section, index) => (
        <button
          key={`${section.label}-${index}`}
          type="button"
          aria-current={index === active ? 'true' : undefined}
          data-testid="settings-section-chip"
          onClick={() => jumpTo(index)}
          className={cn(
            'h-6 shrink-0 whitespace-nowrap rounded-full border px-2.5 text-caption',
            index === active
              ? 'border-accent bg-accent-tint text-accent-fg'
              : 'border-border-default text-fg-muted hover:border-border-strong hover:text-fg-base'
          )}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
