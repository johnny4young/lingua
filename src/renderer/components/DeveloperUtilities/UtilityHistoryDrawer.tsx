import { Trash2 } from 'lucide-react';
import { memo, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUtilityHistoryStore, type UtilityHistoryEntry } from '../../stores/utilityHistoryStore';
import { trackEvent } from '../../utils/telemetry';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { DotLeader, TypeTag } from '../ui/answer';
import { readHistoryAnswer, runTime, shortInput, timedFact, type HistoryAnswer } from './historyAnswers';
import { useToolClock } from './useToolClock';
import '../../i18n/toolAnswersCatalog';
import '../Answer/answerObject.css';
import './utilityHistory.css';

// Module-level stable empty array — using `?? []` inside a Zustand
// selector returns a fresh reference on every read, which triggers an
// infinite render loop because the consumer compares with Object.is.
const EMPTY_ENTRIES: readonly UtilityHistoryEntry[] = Object.freeze([]);

/** Rows shown before the rest fold behind Show N more. */
const SHOWN_RUNS = 3;

/** A value in the answer grammar: a tinted pill for a typed tone, plain text for neutral. */
function ToneText({ tone, className, testId, title, children }: { tone?: HistoryAnswer['tone']; className: string; testId: string; title?: string; children: ReactNode }) {
  const pill = tone !== undefined && tone !== 'neutral';
  return (
    <span
      className={pill ? `${className} answer-object-value value-tone` : className}
      data-tone={pill ? tone : undefined}
      data-pill={pill ? '' : undefined}
      data-testid={testId}
      title={title}
    >
      {children}
    </span>
  );
}

/**
 * Recent runs: each Apply as its time, the input it ran on and the answer it
 * gave. Session history is Free; Save across reloads persists it (Pro), and
 * Clear wipes both session and saved runs for the tool.
 */
export const UtilityHistoryDrawer = memo(function UtilityHistoryDrawer({
  utilityId,
  onApplyEntry,
}: {
  utilityId: DeveloperUtilityId;
  /** Invoked with the clicked entry; the panel puts its input back. */
  onApplyEntry: (entry: UtilityHistoryEntry) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const headingId = useId();
  const lockedId = useId();
  const [showAll, setShowAll] = useState(false);
  const effectiveTier = useEffectiveTier();
  const canPersistHistory = useEntitlement('DEV_UTILITIES');
  const entries = useUtilityHistoryStore(state => state.history[utilityId] ?? EMPTY_ENTRIES);
  const persistEnabled = useUtilityHistoryStore(state => state.persistEnabled[utilityId] ?? false);
  const togglePersist = useUtilityHistoryStore(state => state.togglePersist);
  const clearHistory = useUtilityHistoryStore(state => state.clearHistory);
  const effectivePersistEnabled = canPersistHistory && persistEnabled;
  // Read once per entry; only the time facts and clock labels follow the tick.
  const rows = useMemo(
    () =>
      (showAll ? entries : entries.slice(0, SHOWN_RUNS)).map(entry => {
        const at = Date.parse(entry.at);
        return {
          entry,
          at,
          date: new Date(at).toLocaleString(locale),
          input: entry.input.trim() ? shortInput(entry.input) : t('utilities.history.entryEmpty'),
          inputTitle: entry.input.slice(0, 400),
          // Entries saved before outputTruncated existed fall back to the store's cut marker.
          answer: readHistoryAnswer(utilityId, entry.output, entry.outputTruncated ?? (entry.truncated && entry.output.endsWith('…')), t, locale),
        };
      }),
    [entries, showAll, utilityId, t, locale]
  );
  // Ticks while any run shows, so a run's clock-or-day label turns over at midnight.
  const now = useToolClock(entries, rows.length > 0);
  const hidden = entries.length - rows.length;

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
    setShowAll(false);
    void trackEvent('utility.history.cleared', {
      utilityId,
      scope: effectivePersistEnabled ? 'persisted' : 'session',
    });
  };

  return (
    <section data-testid="utility-history-drawer" aria-labelledby={headingId} className="recent-runs answer-scope">
      <div className="recent-runs-head">
        <h3 id={headingId}>
          <TypeTag>{t('utilities.history.title')}</TypeTag>
        </h3>
        <span className="recent-runs-badge" data-testid="utility-history-badge">
          {effectivePersistEnabled ? t('utilities.history.savedBadge') : t('utilities.history.sessionBadge')}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="recent-runs-empty" data-testid="utility-history-empty">
          {t('utilities.history.empty')}
        </p>
      ) : (
        <ul className="recent-runs-list" data-testid="utility-history-entries">
          {rows.map(({ entry, at, date, input, inputTitle, answer }) => {
            const fact = answer.timed ? timedFact(answer.timed, now, t, locale) : answer.fact;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  data-testid="utility-history-entry"
                  onClick={() => onApplyEntry(entry)}
                  className="recent-run focus-ring"
                >
                  <time className="recent-run-time" dateTime={entry.at} title={date}>
                    {runTime(at, now, locale)}
                  </time>
                  <span className="recent-run-input" title={inputTitle}>
                    {input}
                  </span>
                  <span aria-hidden className="recent-run-break" />
                  <DotLeader className="recent-run-leader" />
                  <span className="recent-run-answer">
                    <ToneText tone={answer.tone} className="recent-run-value" testId="utility-history-answer" title={answer.value}>
                      {answer.swatch ? <span aria-hidden className="recent-run-swatch" style={{ background: answer.swatch }} /> : null}
                      <span className="recent-run-text">{answer.value}</span>
                    </ToneText>
                    {fact ? (
                      <ToneText tone={answer.factTone} className="recent-run-fact" testId="utility-history-fact">
                        {fact}
                      </ToneText>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 || (showAll && entries.length > SHOWN_RUNS) ? (
        <button
          type="button"
          className="recent-runs-more focus-ring"
          data-testid="utility-history-more"
          aria-expanded={showAll}
          onClick={() => setShowAll(value => !value)}
        >
          {showAll ? t('utilities.history.showFewer') : t('utilities.history.showMore', { count: hidden })}
        </button>
      ) : null}
      <div className="recent-runs-controls">
        <label className="recent-runs-persist" data-locked={canPersistHistory ? undefined : ''}>
          <input
            type="checkbox"
            data-testid="utility-history-persist-toggle"
            checked={effectivePersistEnabled}
            disabled={!canPersistHistory}
            aria-describedby={canPersistHistory ? undefined : lockedId}
            onChange={handlePersistToggle}
          />
          <span>{t('utilities.history.persistToggle')}</span>
        </label>
        {!canPersistHistory ? (
          <button
            type="button"
            data-testid="utility-history-persist-unlock"
            onClick={handlePersistToggle}
            title={t('utilities.history.persistLocked')}
            aria-describedby={lockedId}
            className="recent-runs-unlock focus-ring"
          >
            {t('utilities.history.persistUnlock')}
          </button>
        ) : null}
        {!canPersistHistory ? (
          <span id={lockedId} className="sr-only" data-testid="utility-history-persist-locked">
            {t('utilities.history.persistLocked')}
          </span>
        ) : null}
        <button
          type="button"
          data-testid="utility-history-clear"
          onClick={handleClear}
          disabled={entries.length === 0}
          className="recent-runs-clear focus-ring"
        >
          <Trash2 size={11} aria-hidden="true" />
          {t('utilities.history.clear')}
        </button>
      </div>
    </section>
  );
});
