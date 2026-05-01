import { Search, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITIES,
  findDeveloperUtility,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { Eyebrow } from '../ui/primitives';
import { cn } from '../../utils/cn';
import { DeveloperUtilityPanel } from './UtilityPanels';

/**
 * RL-070 Sub-slice 3 — Adaptive utilities layout.
 *
 * Changes from the original modal:
 *
 *   - Sidebar gains a search input that filters by title / description /
 *     keyword (the keywords already live on every utility definition).
 *   - Search empty state ("No utility matches «foo»") replaces the list
 *     when nothing matches; pressing Esc clears the query.
 *   - Modal grows to use the available viewport width (matches what
 *     SettingsModal does post-Sub-slice 2). Tall surfaces like the JWT
 *     debugger now have room for three columns without horizontal scroll
 *     even on 13" laptops.
 *   - Sidebar header uses the new Eyebrow primitive.
 *   - Selected-utility chip in the sidebar uses an accented dot for
 *     stronger visual anchoring instead of the previous bold-blue tint.
 */

interface DeveloperUtilitiesModalProps {
  onClose: () => void;
  initialUtilityId?: DeveloperUtilityId;
}

export function DeveloperUtilitiesModal({
  onClose,
  initialUtilityId = DEFAULT_DEVELOPER_UTILITY_ID,
}: DeveloperUtilitiesModalProps) {
  const { t } = useTranslation();
  const [selectedUtilityId, setSelectedUtilityId] =
    useState<DeveloperUtilityId>(initialUtilityId);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedUtilityId(initialUtilityId);
  }, [initialUtilityId]);

  const selectedUtility = findDeveloperUtility(selectedUtilityId);

  const filteredUtilities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return DEVELOPER_UTILITIES;
    return DEVELOPER_UTILITIES.filter((utility) => {
      // Match against title, description, and keywords. Title + description
      // are i18n keys, so we look up the live translations.
      const title = t(utility.titleKey).toLowerCase();
      const desc = t(utility.descriptionKey).toLowerCase();
      if (title.includes(q) || desc.includes(q)) return true;
      return utility.keywords.some((kw) => kw.toLowerCase().includes(q));
    });
  }, [searchQuery, t]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && searchQuery.length > 0) {
      event.stopPropagation();
      setSearchQuery('');
    }
  };

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        data-testid="developer-utilities-modal"
        className="relative flex h-[min(86vh,860px)] w-[min(96vw,1480px)] max-w-none flex-col overflow-hidden lg:flex-row"
      >
        <aside className="flex w-full shrink-0 flex-col border-b border-border/80 bg-background/55 lg:w-[320px] lg:border-b-0 lg:border-r">
          <div className="surface-header px-5 pt-5 pb-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-primary-soft text-primary">
                  <Wrench size={18} />
                </div>
                <div>
                  <Eyebrow className="mb-0.5">{t('utilities.panelTitle')}</Eyebrow>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t('utilities.title')}
                  </h2>
                </div>
              </div>
              <IconButton
                onClick={onClose}
                tooltip={t('utilities.close')}
                aria-label={t('utilities.close')}
                className="lg:hidden"
              >
                <X size={16} />
              </IconButton>
            </div>
            <p className="mb-3 text-[12px] leading-[1.5] text-muted">
              {t('utilities.description')}
            </p>
            <div className="relative">
              <Search
                size={12}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('utilities.search.placeholder')}
                aria-label={t('utilities.search.ariaLabel')}
                data-testid="utilities-search-input"
                className="w-full rounded-[0.85rem] border border-border/80 bg-background-elevated/88 px-8 py-1.5 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
              />
              {searchQuery.length > 0 ? (
                <span
                  className="kbd-shell absolute right-2 top-1/2 -translate-y-1/2"
                  aria-label={t('utilities.search.escHint')}
                >
                  {t('shortcuts.kbd.escape')}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredUtilities.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-[12px] text-muted">
                  {t('utilities.search.empty', { query: searchQuery })}
                </p>
              </div>
            ) : (
              filteredUtilities.map((utility) => {
                const isSelected = utility.id === selectedUtilityId;
                return (
                  <button
                    key={utility.id}
                    type="button"
                    onClick={() => setSelectedUtilityId(utility.id)}
                    aria-pressed={isSelected}
                    data-testid={`utility-item-${utility.id}`}
                    className={cn(
                      'mb-1 flex w-full items-start gap-2.5 rounded-[1rem] px-3 py-2.5 text-left transition-colors',
                      isSelected
                        ? 'bg-primary-soft'
                        : 'hover:bg-surface-strong/72'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                        isSelected ? 'bg-primary' : 'bg-transparent'
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex flex-col">
                      <span
                        className={cn(
                          'text-[13px] font-semibold leading-tight',
                          isSelected ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {t(utility.titleKey)}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 text-[11.5px] leading-[1.45]',
                          isSelected ? 'text-primary/80' : 'text-muted'
                        )}
                      >
                        {t(utility.descriptionKey)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col bg-surface/38">
          <div className="surface-header flex items-start justify-between px-6 pt-5 pb-4">
            <div className="grid gap-1">
              <Eyebrow className="mb-0">{t('utilities.workspaceLabel')}</Eyebrow>
              <h2 className="font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">
                {t(selectedUtility.titleKey)}
              </h2>
              <p className="mt-1 max-w-3xl text-[12.5px] leading-[1.5] text-muted">
                {t(selectedUtility.descriptionKey)}
              </p>
            </div>
            <IconButton
              onClick={onClose}
              tooltip={t('utilities.close')}
              aria-label={t('utilities.close')}
              className="hidden lg:inline-flex"
            >
              <X size={16} />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <DeveloperUtilityPanel toolId={selectedUtilityId} />
          </div>
        </main>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
