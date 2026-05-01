import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChangelogEntry } from '../../../shared/changelog';
import { getFeaturedChangelogEntry } from '../../../shared/changelog';
import { useAppInfo } from '../../hooks/useAppInfo';
import { OverlayBackdrop, OverlayCard, IconButton } from '../ui/chrome';
import { Eyebrow, Pill } from '../ui/primitives';
import { cn } from '../../utils/cn';

/**
 * RL-070 Sub-slice 5 — Changelog overlay rebuilt as a version timeline.
 *
 * The previous overlay stacked a "current" featured card and a
 * collapsed `<details>` block for older versions. The Signal-Slate
 * design replaces that with a sidebar of versions on the left and a
 * single rich detail pane on the right, with the active version
 * highlighted by an accented dot. The detail pane categorises bullets
 * by section type (Feat / Fix / Perf / Break / Notes) using small
 * color-coded badges that mirror the category-pill pattern from the
 * design system screenshot.
 *
 * Search filters the version list by version string, date, and bullet
 * content. Empty states cover both "no versions at all" and "no match
 * for query".
 */

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const matches = Array.from(text.matchAll(/(\*\*[^*]+\*\*|`[^`]+`)/g));
  if (!matches.length) {
    return [text];
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    const [token] = match;
    const index = match.index ?? 0;

    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`${index}-strong`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`${index}-code`}
          className="rounded-md bg-surface-strong/85 px-1.5 py-0.5 font-mono text-[12px] text-foreground"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    cursor = index + token.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

/**
 * Map a section title (free-form markdown header) to a category badge
 * tone. Falls back to neutral for unrecognised section names — the
 * label still renders, just without a colored pill.
 */
function categorizeSection(title: string): {
  badge: string;
  tone: 'success' | 'warning' | 'error' | 'info' | 'accent' | 'neutral';
} {
  const lowered = title.toLowerCase();
  if (lowered.includes('breaking')) return { badge: 'BREAK', tone: 'error' };
  if (lowered.includes('feat') || lowered.includes('added') || lowered.includes('new'))
    return { badge: 'FEAT', tone: 'success' };
  if (lowered.includes('fix') || lowered.includes('bug')) return { badge: 'FIX', tone: 'info' };
  if (lowered.includes('perf') || lowered.includes('speed'))
    return { badge: 'PERF', tone: 'accent' };
  if (lowered.includes('deprec')) return { badge: 'DEPR', tone: 'warning' };
  return { badge: title.slice(0, 6).toUpperCase(), tone: 'neutral' };
}

interface WhatsNewSectionProps {
  entries: ChangelogEntry[];
  onClose: () => void;
}

export function WhatsNewSection({ entries, onClose }: WhatsNewSectionProps) {
  const appInfo = useAppInfo();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [hasUserSelectedVersion, setHasUserSelectedVersion] = useState(false);

  const currentVersion = appInfo?.version ?? null;
  const featuredEntry = getFeaturedChangelogEntry(entries, currentVersion);

  // Search across version, date, section titles, and bullet content.
  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return entries;
    return entries.filter((entry) => {
      if (entry.version.toLowerCase().includes(q)) return true;
      if (entry.date && entry.date.toLowerCase().includes(q)) return true;
      return entry.sections.some(
        (section) =>
          section.title.toLowerCase().includes(q) ||
          section.items.some((item) => item.toLowerCase().includes(q))
      );
    });
  }, [entries, query]);

  const [selectedVersion, setSelectedVersion] = useState<string | null>(
    featuredEntry?.version ?? entries[0]?.version ?? null
  );

  useEffect(() => {
    if (hasUserSelectedVersion) return;
    setSelectedVersion(featuredEntry?.version ?? entries[0]?.version ?? null);
  }, [entries, featuredEntry?.version, hasUserSelectedVersion]);

  // Keep selection valid when the filter narrows it out.
  const selectedEntry = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    const match = filteredEntries.find((entry) => entry.version === selectedVersion);
    return match ?? filteredEntries[0] ?? null;
  }, [filteredEntries, selectedVersion]);

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard className="relative flex h-[min(86vh,820px)] w-[min(96vw,1180px)] max-w-none flex-col overflow-hidden lg:flex-row">
        {/* Sidebar — version timeline */}
        <aside className="flex w-full shrink-0 flex-col border-b border-border/80 bg-background/55 lg:w-[280px] lg:border-b-0 lg:border-r">
          <div className="surface-header px-5 pt-5 pb-3">
            <Eyebrow className="mb-0.5">{t('whatsNew.title')}</Eyebrow>
            <h2 className="font-display text-[18px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">
              {t('whatsNew.subtitle')}
            </h2>
            <p className="mt-1 text-[11.5px] leading-[1.45] text-muted">
              {t('whatsNew.versionsCount', {
                count: entries.length,
              })}
            </p>
            <div className="relative mt-3">
              <Search
                size={12}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('whatsNew.search.placeholder')}
                aria-label={t('whatsNew.search.ariaLabel')}
                data-testid="changelog-search"
                className="w-full rounded-[0.85rem] border border-border/80 bg-background-elevated/88 px-8 py-1.5 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {filteredEntries.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-[12px] text-muted">
                  {t('whatsNew.search.empty', {
                    query,
                  })}
                </p>
              </div>
            ) : (
              filteredEntries.map((entry) => {
                const isSelected = selectedEntry?.version === entry.version;
                const isCurrent = currentVersion === entry.version;
                return (
                  <button
                    key={`${entry.version}-${entry.date ?? 'undated'}`}
                    type="button"
                    onClick={() => {
                      setHasUserSelectedVersion(true);
                      setSelectedVersion(entry.version);
                    }}
                    aria-pressed={isSelected}
                    data-testid={`changelog-entry-${entry.version}`}
                    className={cn(
                      'mb-1 flex w-full items-start gap-2.5 rounded-[1rem] px-3 py-2 text-left transition-colors',
                      isSelected ? 'bg-primary-soft' : 'hover:bg-surface-strong/72'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                        isSelected ? 'bg-primary' : 'bg-border-strong/60'
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex flex-col">
                      <span
                        className={cn(
                          'font-mono text-[13px] font-semibold leading-tight',
                          isSelected ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {entry.version}
                      </span>
                      <span className="mt-0.5 text-[11px] text-muted">
                        {entry.unreleased
                          ? t('whatsNew.entry.unreleased')
                          : (entry.date ?? '—')}
                      </span>
                      {isCurrent ? (
                        <Pill tone="accent" className="mt-1.5 self-start">
                          {t('whatsNew.entry.currentBadge')}
                        </Pill>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Detail pane — selected version */}
        <main className="flex min-h-0 flex-1 flex-col bg-surface/38">
          <div className="surface-header flex items-start justify-between px-6 pt-5 pb-4">
            {selectedEntry ? (
              <div>
                <Eyebrow>
                  {t('whatsNew.entry.releaseLabel')}
                  {selectedEntry.date ? ` · ${selectedEntry.date}` : null}
                </Eyebrow>
                <div className="flex items-baseline gap-3">
                  <h2 className="font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground">
                    {selectedEntry.version}
                  </h2>
                  {selectedEntry.unreleased ? (
                    <Pill tone="warning">
                      {t('whatsNew.entry.unreleased')}
                    </Pill>
                  ) : null}
                </div>
                <p className="mt-1 max-w-2xl text-[12.5px] leading-[1.5] text-muted">
                  {t('whatsNew.description')}
                </p>
              </div>
            ) : (
              <div>
                <Eyebrow>{t('whatsNew.title')}</Eyebrow>
                <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">
                  {t('whatsNew.empty')}
                </h2>
              </div>
            )}
            <IconButton onClick={onClose} tooltip={t('whatsNew.close')}>
              <X size={16} />
            </IconButton>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {selectedEntry ? (
              <div className="space-y-5">
                {selectedEntry.sections.map((section) => {
                  const cat = categorizeSection(section.title);
                  return (
                    <section key={`${selectedEntry.version}-${section.title}`}>
                      <div className="mb-2 flex items-center gap-2">
                        <Pill tone={cat.tone}>{cat.badge}</Pill>
                        <h4 className="text-[12.5px] font-semibold text-foreground">
                          {section.title}
                        </h4>
                      </div>
                      <ul className="space-y-1.5 border-l-2 border-border/60 pl-4">
                        {section.items.map((item) => (
                          <li
                            key={item}
                            className="text-[13px] leading-[1.55] text-foreground/90"
                          >
                            {renderInlineMarkdown(item)}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[1.15rem] border border-border/80 bg-background-elevated/72 p-6 text-center">
                <p className="text-[13px] font-medium text-foreground">
                  {t('whatsNew.empty')}
                </p>
              </div>
            )}
          </div>
        </main>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
