import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import '../../i18n/runCompareCatalog';
import { type ExecutionHistoryEntry, useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { canOpenComparedRun, openComparedRunInNewTab } from '../../utils/openCapsuleTab';
import type { RunCompareRecord } from '../../utils/runCompareRecord';
import { languageShortLabel } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { formatBinarySize } from '../../utils/formatSize';
import { formatRunDuration } from '../../utils/timeLabels';
import type { Language } from '../../types/language';
import { EyebrowMono } from '../ui/primitives';
import {
  compareRunRecords,
  defaultRunSelection,
  groupRunsByDay,
  runOutputLine,
  runRuntimeLabel,
  orderRunPair,
  toggleRunSelection,
  type RunCompareSection,
} from './runCompareModel';

type Translate = ReturnType<typeof useTranslation>['t'];

function runtimeText(record: RunCompareRecord): string {
  const language = languageShortLabel(record.language as Language);
  const runtime = runRuntimeLabel(record);
  return runtime ? `${language} · ${runtime}` : language;
}

function resultText(record: RunCompareRecord, t: Translate): string {
  if (record.exit !== 'success' && record.errorMessage) return record.errorMessage.split('\n')[0]!;
  const { summary } = record;
  if (summary?.kind === 'rows') return t('runCompare.summary.rows', { count: summary.count, columns: summary.columns.join(', ') });
  if (summary?.kind === 'http') {
    return t('runCompare.summary.http', { status: summary.status, statusText: summary.statusText, size: formatBinarySize(summary.bytes) });
  }
  return runOutputLine(record) || t('runCompare.noOutput');
}

function DiffRows({ section, t, testId }: { section: RunCompareSection; t: Translate; testId: string }) {
  if (!section.changed) return <p className="text-fg-subtle">{t('runCompare.same')}</p>;
  return (
    <ul className="grid font-mono text-caption leading-[21px]" data-testid={testId}>
      {section.rows.map((row, index) =>
        row.kind === 'same' ? (
          <li key={index} className="px-2 text-fg-subtle">
            {t('runCompare.unchanged', { count: row.count })}
          </li>
        ) : (
          <li
            key={index}
            data-kind={row.kind}
            className={cn(
              'whitespace-pre-wrap break-words rounded px-2',
              row.kind === 'add' ? 'bg-success-bg text-success-fg' : 'bg-error-bg text-error-fg'
            )}
          >
            {`${row.kind === 'add' ? '+' : '-'} ${row.text}`}
          </li>
        )
      )}
      {section.cut ? <li className="px-2 text-fg-subtle">{t('runCompare.cut')}</li> : null}
    </ul>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h4 className="mt-3 mb-1 font-mono text-caption font-normal text-fg-subtle first:mt-0">{children}</h4>;
}

function ComparePane({
  older,
  newer,
  timeOf,
}: {
  older: ExecutionHistoryEntry;
  newer: ExecutionHistoryEntry;
  timeOf: (entry: ExecutionHistoryEntry) => string;
}) {
  const { t } = useTranslation();
  const togglePin = useExecutionHistoryStore(state => state.togglePin);
  const before = older.runCompare!;
  const after = newer.runCompare!;
  const comparison = useMemo(() => compareRunRecords(before, after), [before, after]);
  const exitText = `${t(`runCompare.exit.${before.exit}`)} → ${t(`runCompare.exit.${after.exit}`)} · ${formatRunDuration(older.durationMs)} → ${formatRunDuration(newer.durationMs)}`;

  return (
    <div data-testid="run-compare-compare">
      <EyebrowMono>{t('runCompare.compare.title', { from: timeOf(older), to: timeOf(newer) })}</EyebrowMono>
      {before.truncated || after.truncated ? (
        <p className="mt-1 text-caption text-warning-fg" data-testid="run-compare-truncated">
          {t('runCompare.truncated')}
        </p>
      ) : null}
      <SectionLabel>{t('runCompare.section.code')}</SectionLabel>
      <DiffRows section={comparison.code} t={t} testId="run-compare-code" />
      <SectionLabel>{t('runCompare.section.output')}</SectionLabel>
      <DiffRows section={comparison.stdout} t={t} testId="run-compare-stdout" />
      <SectionLabel>{t('runCompare.section.values')}</SectionLabel>
      {!comparison.valuesTracked ? (
        <p className="text-fg-subtle">{t('runCompare.values.none')}</p>
      ) : comparison.values.length === 0 ? (
        <p className="text-fg-subtle">{t('runCompare.same')}</p>
      ) : (
        <ul className="grid font-mono text-caption leading-[21px]" data-testid="run-compare-values">
          {comparison.values.map(change => (
            <li key={change.line} className="flex gap-3 px-2">
              <span className="w-10 shrink-0 text-fg-subtle">L{change.line}</span>
              <span className="min-w-0 break-words text-fg-base">
                {change.before ?? t('runCompare.values.missing')} → {change.after ?? t('runCompare.values.missing')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <SectionLabel>{t('runCompare.section.exit')}</SectionLabel>
      <p className="px-2 font-mono text-caption text-fg-base" data-testid="run-compare-exit">
        {exitText}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canOpenComparedRun(before.language) ? (
          <button
            type="button"
            className="button-secondary h-7 px-2.5 text-caption"
            data-testid="run-compare-restore"
            onClick={() => openComparedRunInNewTab({ name: `${before.name} · ${timeOf(older)}`, language: before.language, code: before.code })}
          >
            {t('runCompare.restore')}
          </button>
        ) : null}
        <button
          type="button"
          className="button-secondary h-7 px-2.5 text-caption"
          aria-pressed={older.pinned === true}
          data-testid="run-compare-pin"
          onClick={() => togglePin(older.id)}
        >
          {t(older.pinned ? 'runCompare.unpin' : 'runCompare.pin')}
        </button>
      </div>
    </div>
  );
}

/** The Compare tab with Compare runs on: runs by day, and a diff of any two. */
export function RunComparePanel({ activeTabId }: { activeTabId: string | null }) {
  const { t, i18n } = useTranslation();
  const entries = useExecutionHistoryStore(state => state.entries);
  // Until the user ticks a box, follow the active tab's last two runs.
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? defaultRunSelection(entries, activeTabId);
  const [now, setNow] = useState(Date.now);
  // Move Today to Yesterday at midnight while the tab stays open.
  useEffect(() => {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timer = setTimeout(() => setNow(Date.now()), midnight.getTime() - now + 1000);
    return () => clearTimeout(timer);
  }, [now]);
  const groups = useMemo(() => groupRunsByDay(entries, Math.max(now, entries.at(-1)?.timestamp ?? 0)), [entries, now]);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }), [i18n.language]);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }), [i18n.language]);
  const timeOf = (entry: ExecutionHistoryEntry) => timeFormat.format(entry.timestamp);
  const liveSelection = selected.filter(id => entries.some(entry => entry.id === id && entry.runCompare));
  const pair = orderRunPair(entries, liveSelection);
  const pinned = entries.filter(entry => entry.pinned).length;

  return (
    <div data-testid="run-compare" className="run-compare flex h-full min-h-0 flex-col bg-bg-panel text-body-sm">
      <header className="flex h-[34px] shrink-0 items-center gap-3 border-b border-border-subtle px-3">
        <EyebrowMono>{t('runCompare.title')}</EyebrowMono>
        <span className="truncate font-mono text-caption text-fg-muted">
          {t('runCompare.count', { count: entries.length })}
          {pinned > 0 ? ` · ${t('runCompare.pinned', { count: pinned })}` : ''}
        </span>
        <span className="flex-1" />
        {liveSelection.length > 0 ? (
          <button
            type="button"
            className="inline-flex h-[24px] shrink-0 items-center gap-1 rounded-full border border-accent bg-primary-soft px-2.5 text-caption text-accent-fg"
            onClick={() => setPicked([])}
            title={t('runCompare.clearSelection')}
            aria-label={`${t('runCompare.selected', { count: liveSelection.length })}, ${t('runCompare.clearSelection')}`}
            data-testid="run-compare-selected"
          >
            {t('runCompare.selected', { count: liveSelection.length })}
            <X size={12} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div className="run-compare-body min-h-0 flex-1">
        <div className="run-compare-list min-h-0 overflow-y-auto" role="group" aria-label={t('runCompare.title')}>
          {groups.map(group => (
            <section key={group.day}>
              <h3 className="px-2.5 pt-2 pb-1 font-mono text-micro uppercase tracking-[0.12em] text-fg-subtle">
                {group.key === 'earlier' ? dayFormat.format(group.day) : t(`runCompare.day.${group.key}`)}
              </h3>
              <ul>
                {group.entries.map(entry => {
                  const record = entry.runCompare;
                  const checked = liveSelection.includes(entry.id);
                  const name = record?.name ?? entry.language;
                  return (
                    <li key={entry.id}>
                      <label
                        className={cn(
                          'flex h-[34px] items-center gap-2.5 border-b border-border-subtle px-2.5 text-body-sm',
                          checked && 'bg-primary-soft',
                          record ? 'cursor-pointer' : 'opacity-60'
                        )}
                        title={record ? undefined : t('runCompare.notComparable')}
                        data-testid="run-compare-row"
                      >
                        <input
                          type="checkbox"
                          className="run-compare-check"
                          checked={checked}
                          disabled={!record}
                          onChange={() => setPicked(toggleRunSelection(liveSelection, entry.id))}
                          aria-label={t('runCompare.select', { name, time: timeOf(entry) })}
                        />
                        <span
                          className={cn(
                            'inline-flex h-[18px] w-9 shrink-0 items-center justify-center rounded border font-mono text-micro font-semibold uppercase',
                            entry.status === 'ok'
                              ? 'border-success-border bg-success-bg text-success-fg'
                              : 'border-error-border bg-error-bg text-error-fg'
                          )}
                        >
                          {t(entry.status === 'ok' ? 'runCompare.status.ok' : 'runCompare.status.error')}
                        </span>
                        <span className="w-[150px] shrink-0 truncate text-fg-base">{name}</span>
                        <span className="w-[92px] shrink-0 truncate font-mono text-caption text-fg-muted">
                          {record ? runtimeText(record) : entry.language}
                        </span>
                        <span className="w-[58px] shrink-0 truncate font-mono text-caption text-fg-muted">
                          {formatRunDuration(entry.durationMs)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-caption text-fg-base">
                          {record ? resultText(record, t) : ''}
                        </span>
                        <span className="shrink-0 font-mono text-caption text-fg-subtle">{timeOf(entry)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <section className="min-h-0 overflow-y-auto px-3.5 py-2.5" aria-live="polite">
          {pair ? (
            <ComparePane older={pair[0]} newer={pair[1]} timeOf={timeOf} />
          ) : (
            <p className="text-fg-subtle" data-testid="run-compare-pick">
              {t('runCompare.pickTwo')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
