import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/httpBuilderCatalog';
import {
  DEFAULT_SNAPSHOT_SCRUBBERS,
  isUsableScrubPattern,
  takeSnapshot,
  type SnapshotChange,
} from '../../../shared/httpSnapshot';
import type { HttpResponseSnapshot, HttpResponseV1, HttpSnapshotScrubbers } from '../../../shared/httpWorkspaceSchema';
import { formatRelativeTime } from '../../utils/timeLabels';
import { Toggle } from '../Settings/shared';
import { ENVIRONMENT_TINTS, tintPill } from './httpScopeColors';

const SCRUBBER_FLAGS = ['timestamps', 'uuids', 'ids', 'hostname'] as const;
const EYEBROW = 'text-eyebrow font-semibold uppercase tracking-wide text-fg-subtle';

/**
 * The Snapshot tab: keep this response as the baseline, then review later
 * responses as a diff to accept or reject, with scrubbers for the values that
 * change on every call.
 */
export function HttpSnapshotPanel({
  response,
  snapshot,
  changes,
  onChange,
  rejected,
  onReject,
}: {
  response: HttpResponseV1;
  snapshot: HttpResponseSnapshot | undefined;
  changes: readonly SnapshotChange[];
  onChange: (snapshot: HttpResponseSnapshot | undefined) => void;
  /** Reject keeps the snapshot and the failure; it only closes the diff for this response. */
  rejected: boolean;
  onReject: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [now] = useState(() => Date.now());
  const scrubbers = snapshot?.scrubbers ?? DEFAULT_SNAPSHOT_SCRUBBERS;
  const fresh = useMemo(() => takeSnapshot(response, scrubbers), [response, scrubbers]);
  const setScrubbers = (next: HttpSnapshotScrubbers) => {
    if (snapshot) onChange({ ...snapshot, scrubbers: next });
  };
  const [pattern, setPattern] = useState(scrubbers.regex);
  const [storedPattern, setStoredPattern] = useState(scrubbers.regex);
  if (storedPattern !== scrubbers.regex) {
    setStoredPattern(scrubbers.regex);
    setPattern(scrubbers.regex);
  }
  const commitPattern = () => {
    if (pattern !== scrubbers.regex) setScrubbers({ ...scrubbers, regex: pattern });
  };
  const reviewing = snapshot !== undefined && changes.length > 0 && !rejected;

  return (
    <div data-testid="http-snapshot" data-state={!snapshot ? 'off' : changes.length > 0 ? 'changed' : 'matches'} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={EYEBROW}>{t('httpWorkspace.snapshot.title')}</span>
        <Toggle
          value={snapshot !== undefined}
          aria-label={t('httpWorkspace.snapshot.toggle')}
          data-testid="http-snapshot-toggle"
          disabled={!snapshot && !fresh}
          onChange={() => onChange(snapshot ? undefined : (fresh ?? undefined))}
        />
        {snapshot ? (
          <span
            data-testid="http-snapshot-badge"
            className="rounded-sm px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide"
            style={tintPill(changes.length > 0 ? ENVIRONMENT_TINTS.orange : ENVIRONMENT_TINTS.green)}
          >
            {changes.length > 0 ? t('httpWorkspace.snapshot.changes', { count: changes.length }) : t('httpWorkspace.snapshot.matches')}
          </span>
        ) : null}
        {reviewing ? (
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              data-testid="http-snapshot-reject"
              onClick={onReject}
              className="focus-ring rounded-md border border-border-subtle px-2 py-0.5 text-caption font-medium text-fg-base hover:bg-bg-inset"
            >
              {t('httpWorkspace.snapshot.reject')}
            </button>
            <button
              type="button"
              data-testid="http-snapshot-accept"
              disabled={!fresh}
              onClick={() => fresh && onChange(fresh)}
              className="focus-ring rounded-md border border-accent bg-accent px-2 py-0.5 text-caption font-semibold text-fg-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              {t('httpWorkspace.snapshot.accept')}
            </button>
          </span>
        ) : null}
      </div>

      {!snapshot ? (
        <p className="text-caption text-fg-subtle">{t(fresh ? 'httpWorkspace.snapshot.off' : 'httpWorkspace.snapshot.tooLarge')}</p>
      ) : (
        <p className="text-caption text-fg-subtle">
          {t('httpWorkspace.snapshot.baseline', { age: formatRelativeTime(Math.min(Date.parse(snapshot.recordedAt), now), now, i18n.language) })}
        </p>
      )}

      {snapshot && changes.length > 0 ? (
        <ul data-testid="http-snapshot-diff" role="list" className="flex flex-col gap-0.5 font-mono text-caption">
          {changes.map((change) => (
            <li key={`${change.kind}:${change.path}`} data-kind={change.kind} className="flex flex-col">
              {change.kind !== 'added' ? (
                <span className="rounded-sm px-1.5" style={tintPill(ENVIRONMENT_TINTS.red)}>
                  {`- ${change.path}: ${change.before}`}
                </span>
              ) : null}
              {change.kind !== 'removed' ? (
                <span className="rounded-sm px-1.5" style={tintPill(ENVIRONMENT_TINTS.green)}>
                  {`+ ${change.path}: ${change.after}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {snapshot ? (
        <div className="flex flex-col gap-1.5">
          <span className={EYEBROW}>{t('httpWorkspace.snapshot.scrubbers')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SCRUBBER_FLAGS.map((flag) => (
              <button
                key={flag}
                type="button"
                aria-pressed={scrubbers[flag]}
                data-scrubber={flag}
                onClick={() => setScrubbers({ ...scrubbers, [flag]: !scrubbers[flag] })}
                className={
                  scrubbers[flag]
                    ? 'focus-ring rounded-md bg-accent-tint px-2 py-0.5 font-mono text-caption font-semibold text-accent-fg'
                    : 'focus-ring rounded-md border border-border-subtle px-2 py-0.5 font-mono text-caption text-fg-subtle hover:text-fg-base'
                }
              >
                {t(`httpWorkspace.snapshot.scrubber.${flag}`)}
              </button>
            ))}
            <input
              type="text"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              // Committed on blur or Enter, so the diff is not recomputed on every keystroke.
              onBlur={commitPattern}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitPattern();
              }}
              aria-invalid={pattern.length > 0 && !isUsableScrubPattern(pattern)}
              placeholder={t('httpWorkspace.snapshot.scrubber.regex')}
              aria-label={t('httpWorkspace.snapshot.scrubber.regexLabel')}
              spellCheck={false}
              data-testid="http-snapshot-regex"
              className="h-7 w-40 rounded-md border border-border-subtle bg-bg-inset px-2 font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
