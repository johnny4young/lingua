import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChangelogEntry } from '../../../shared/changelog';
import { getFeaturedChangelogEntry } from '../../../shared/changelog';
import { useAppInfo } from '../../hooks/useAppInfo';
import { OverlayBackdrop, OverlayCard, IconButton } from '../ui/chrome';

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

function EntryCard({
  entry,
  title,
  emphasized = false,
}: {
  entry: ChangelogEntry;
  title: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={
        emphasized
          ? 'rounded-[1.35rem] border border-primary/25 bg-primary-soft/45 p-4'
          : 'rounded-[1.15rem] border border-border/80 bg-background-elevated/72 p-4'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-xl font-semibold tracking-[-0.04em] text-foreground">
            {title}
          </h3>
          {entry.date && <p className="mt-1 text-xs text-muted">{entry.date}</p>}
        </div>
        <span className="status-pill">{entry.version}</span>
      </div>

      <div className="mt-4 space-y-4">
        {entry.sections.map((section) => (
          <section key={`${entry.version}-${section.title}`} className="space-y-2">
            <h4 className="panel-title">{section.title}</h4>
            <ul className="space-y-2 text-sm leading-6 text-muted">
              {section.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/80" />
                  <span>{renderInlineMarkdown(item)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

interface WhatsNewSectionProps {
  entries: ChangelogEntry[];
  onClose: () => void;
}

export function WhatsNewSection({ entries, onClose }: WhatsNewSectionProps) {
  const appInfo = useAppInfo();
  const { t } = useTranslation();

  const currentVersion = appInfo?.version ?? null;
  const featuredEntry = getFeaturedChangelogEntry(entries, currentVersion);
  const remainingEntries = featuredEntry
    ? entries.filter((entry) => entry !== featuredEntry)
    : entries;

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard className="relative w-[min(96vw,1080px)] max-w-none">
        <div className="surface-header flex items-start justify-between gap-4 px-5 py-4">
          <div>
            <p className="panel-title">{t('whatsNew.title')}</p>
            <h2 className="mt-2 font-display text-[2rem] font-semibold tracking-[-0.04em] text-foreground">
              {t('whatsNew.subtitle')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {t('whatsNew.description')}
            </p>
          </div>
          <IconButton onClick={onClose} tooltip={t('whatsNew.close')}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="max-h-[78vh] space-y-4 overflow-y-auto px-5 py-4">
          {featuredEntry ? (
            <EntryCard
              entry={featuredEntry}
              title={
                featuredEntry.unreleased
                  ? t('whatsNew.entry.unreleased')
                  : t('whatsNew.entry.current')
              }
              emphasized
            />
          ) : (
            <div className="rounded-[1.15rem] border border-border/80 bg-background-elevated/72 p-4 text-sm text-muted">
              {t('whatsNew.empty')}
            </div>
          )}

          {remainingEntries.length > 0 && (
            <details className="rounded-[1.15rem] border border-border/80 bg-background-elevated/72 p-4">
              <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                {t('whatsNew.previous')}
              </summary>
              <div className="mt-4 space-y-4">
                {remainingEntries.map((entry) => (
                  <EntryCard
                    key={`${entry.version}-${entry.date ?? 'undated'}`}
                    entry={entry}
                    title={entry.unreleased ? t('whatsNew.entry.unreleased') : entry.version}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
