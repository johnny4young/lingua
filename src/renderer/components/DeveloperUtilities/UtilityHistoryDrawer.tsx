import { History, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUtilityHistoryStore, type UtilityHistoryEntry } from '../../stores/utilityHistoryStore';
import { trackEvent } from '../../utils/telemetry';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { pushUpsellNotice } from '../../utils/upsellNotice';

// Module-level stable empty array — using `?? []` inside a Zustand
// selector returns a fresh reference on every read, which triggers an
// infinite render loop because the consumer compares with Object.is.
const EMPTY_ENTRIES: readonly UtilityHistoryEntry[] = Object.freeze([]);

/**
 * RL-069 Slice 3 — Inline collapsible "Recent runs" drawer rendered
 * next to each panel's <UtilityToolbar>. Default collapsed so the
 * existing layout stays intact; expanding shows the last N entries
 * (capped by `MAX_ENTRIES_PER_TOOL`) plus the Save-across-reloads
 * toggle and a Clear control.
 *
 * Session history is Free and stays local to the current boot.
 * Persistence is the Pro workflow layer — flipping the toggle
 * starts/stops persisting the tool's entries. Clearing wipes both
 * session AND persisted state for the active tool.
 */
export function UtilityHistoryDrawer({
  utilityId,
  onApplyEntry,
}: {
  utilityId: DeveloperUtilityId;
  /**
   * Imperative apply — invoked when the user clicks an entry. The
   * panel decides what to do with the historical input (typically
   * `setInput(entry.input)`).
   */
  onApplyEntry: (entry: UtilityHistoryEntry) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const effectiveTier = useEffectiveTier();
  const canPersistHistory = useEntitlement('DEV_UTILITIES');
  const entries = useUtilityHistoryStore(state => state.history[utilityId] ?? EMPTY_ENTRIES);
  const persistEnabled = useUtilityHistoryStore(state => state.persistEnabled[utilityId] ?? false);
  const togglePersist = useUtilityHistoryStore(state => state.togglePersist);
  const clearHistory = useUtilityHistoryStore(state => state.clearHistory);
  const effectivePersistEnabled = canPersistHistory && persistEnabled;

  const handlePersistToggle = () => {
    if (!canPersistHistory) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: t('upsell.feature.utilityWorkflows'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'utility-history-persistence',
        tier: effectiveTier,
      });
      return;
    }
    togglePersist(utilityId);
  };

  const handleClear = () => {
    clearHistory(utilityId);
    void trackEvent('utility.history.cleared', {
      utilityId,
      scope: effectivePersistEnabled ? 'persisted' : 'session',
    });
  };

  return (
    <details
      data-testid="utility-history-drawer"
      open={expanded}
      onToggle={event => setExpanded((event.target as HTMLDetailsElement).open)}
      className="min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-background/55"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-2xl px-3 py-2 text-body-sm font-medium text-foreground hover:bg-surface-strong/40">
        <span className="inline-flex items-center gap-1.5">
          <History size={12} aria-hidden="true" />
          {t('utilities.history.title')}
          <span className="text-muted">({entries.length})</span>
        </span>
        <span className="text-caption text-muted">
          {effectivePersistEnabled
            ? t('utilities.history.savedBadge')
            : t('utilities.history.sessionBadge')}
        </span>
      </summary>
      <div className="grid gap-2 px-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
          <label
            className={`inline-flex items-center gap-1.5 ${
              canPersistHistory ? 'cursor-pointer' : 'cursor-not-allowed opacity-65'
            }`}
          >
            <input
              type="checkbox"
              data-testid="utility-history-persist-toggle"
              checked={effectivePersistEnabled}
              disabled={!canPersistHistory}
              onChange={handlePersistToggle}
            />
            <span>{t('utilities.history.persistToggle')}</span>
          </label>
          {!canPersistHistory ? (
            <button
              type="button"
              data-testid="utility-history-persist-unlock"
              onClick={handlePersistToggle}
              className="rounded-full border border-warning/40 bg-warning/10 px-2 py-1 font-medium text-warning hover:border-warning"
            >
              {t('utilities.history.persistUnlock')}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="utility-history-clear"
            onClick={handleClear}
            disabled={entries.length === 0}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/80 px-2 py-1 text-caption font-medium text-foreground transition-colors hover:border-danger/60 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={11} aria-hidden="true" />
            {t('utilities.history.clear')}
          </button>
        </div>
        {!canPersistHistory ? (
          <p
            className="text-caption leading-5 text-muted"
            data-testid="utility-history-persist-locked"
          >
            {t('utilities.history.persistLocked')}
          </p>
        ) : null}
        {entries.length === 0 ? (
          <p className="text-caption text-muted" data-testid="utility-history-empty">
            {t('utilities.history.empty')}
          </p>
        ) : (
          <ul className="grid gap-1" data-testid="utility-history-entries">
            {entries.map(entry => (
              <li key={entry.id}>
                <button
                  type="button"
                  data-testid="utility-history-entry"
                  onClick={() => onApplyEntry(entry)}
                  className="flex w-full min-w-0 items-baseline justify-between gap-2 rounded-lg border border-border/70 bg-background/55 px-2 py-1.5 text-left text-caption text-foreground transition-colors hover:border-primary/50"
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {entry.input || t('utilities.history.entryEmpty')}
                  </span>
                  <span className="shrink-0 text-muted">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
