import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DIFF_MAX_INPUT_CHARS, type DiffSegment } from '../../utils/diff';
import type { RunCapsuleStatus, RunCapsuleV1 } from '../../../shared/runCapsule';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import {
  compareRunCapsules,
  type CapsuleComparison,
  type CapsuleComparisonSection,
} from './capsuleComparison';

/**
 * RL-094 Slice 4 — read-only side-by-side comparator for two run
 * capsules. Mirrors `ExecutionComparisonModal` (RL-028 Slice 7): an
 * `OverlayBackdrop`/`OverlayCard` dialog with an Escape-closes effect, a
 * summary strip, and the older-on-the-left / newer-on-the-right pane
 * grid. It extends that precedent with:
 *
 *   - fold A — a Code | Input | Output tab bar; the active section
 *     renders the two `<pre>` panes plus the line-by-line diff below.
 *   - fold E — environment chips (platform / runner / git branch /
 *     commit) shown as `older → newer` only when they differ.
 *
 * `capsules` is `[older, newer]` sorted oldest → newest by the caller.
 * All logic lives in `compareRunCapsules`; this component is purely
 * presentational.
 */
export interface CapsuleComparisonModalProps {
  capsules: [RunCapsuleV1, RunCapsuleV1] | null;
  onClose: () => void;
}

type SectionKey = 'code' | 'input' | 'output';

function formatDuration(durationMs: number): string {
  if (durationMs < 10) return `${durationMs.toFixed(1)} ms`;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatDelta(olderMs: number, newerMs: number): string {
  const delta = newerMs - olderMs;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const magnitude = Math.abs(delta);
  if (magnitude < 10) return `${sign}${magnitude.toFixed(1)} ms`;
  if (magnitude < 1000) return `${sign}${Math.round(magnitude)} ms`;
  return `${sign}${(magnitude / 1000).toFixed(2)} s`;
}

function DiffLine({ segment }: { segment: DiffSegment }) {
  const isAdd = segment.kind === 'add';
  const isRemove = segment.kind === 'remove';
  const tone = isAdd
    ? 'bg-success/10 text-success'
    : isRemove
      ? 'bg-error/10 text-error'
      : 'text-muted';
  const sigil = isAdd ? '+' : isRemove ? '−' : ' ';
  return (
    <div
      className={`flex gap-2 whitespace-pre-wrap px-3 py-0.5 font-mono text-body-sm leading-5 ${tone}`}
      data-testid={`capsule-compare-diff-line-${segment.kind}`}
    >
      <span aria-hidden="true" className="select-none opacity-60">
        {sigil}
      </span>
      <span>{segment.text === '' ? ' ' : segment.text}</span>
    </div>
  );
}

/**
 * Compact env-delta chip, rendered only when the two sides differ.
 * `text` is the already-localized `"Platform: web → desktop"` line;
 * `differs` gates visibility so the env block stays terse when the run
 * environment matched.
 */
function EnvChip({
  testid,
  text,
  differs,
}: {
  testid: string;
  text: string;
  differs: boolean;
}) {
  if (!differs) return null;
  return (
    <div
      data-testid={testid}
      className="font-mono text-caption text-foreground"
    >
      {text}
    </div>
  );
}

export function CapsuleComparisonModal({ capsules, onClose }: CapsuleComparisonModalProps) {
  const { t, i18n } = useTranslation();
  // Track the user's explicit tab pick TOGETHER with the pair it was made
  // against, so we can DERIVE the effective section without a
  // setState-in-effect: a pick from a stale pair (the parent swapped
  // `capsules`) reads as "no pick" and the tab resets to Code on the
  // fresh pair. Mirrors the `pickedId`/`selected` derive pattern in
  // `CapsuleListOverlay`. `null` = no pick yet → Code default.
  const [pick, setPick] = useState<{
    capsules: [RunCapsuleV1, RunCapsuleV1];
    section: SectionKey;
  } | null>(null);

  // Escape closes — `OverlayBackdrop` only handles the backdrop click.
  // Mirror `ExecutionComparisonModal`: attach a window listener while
  // open, tear it down on unmount (parent flips `capsules` to null).
  useEffect(() => {
    if (!capsules) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capsules, onClose]);

  const model = useMemo<CapsuleComparison | null>(
    () => (capsules ? compareRunCapsules(capsules[0], capsules[1]) : null),
    [capsules]
  );

  const sections = useMemo<
    ReadonlyArray<{ key: SectionKey; section: CapsuleComparisonSection }>
  >(
    () =>
      model
        ? [
            { key: 'code', section: model.codeDiff },
            { key: 'input', section: model.inputDiff },
            { key: 'output', section: model.outputDiff },
          ]
        : [],
    [model]
  );

  if (!capsules || !model) return null;

  const statusLabel = (status: RunCapsuleStatus): string =>
    t(`capsule.compare.status.${status}`);

  // Derive the active section: honor the user's pick only when it was made
  // against THIS pair AND points at a non-empty section; otherwise default
  // to the first NON-EMPTY section. (We only reach this branch when
  // `contentIdentical` is false, so at least one section is non-empty — but
  // Code itself can be empty when the two runs differ only in input/output,
  // and a disabled empty Code tab is a poor landing default.)
  const firstNonEmpty: SectionKey =
    sections.find((entry) => !entry.section.empty)?.key ?? 'code';
  const pickedEntry =
    pick && pick.capsules === capsules
      ? sections.find((entry) => entry.key === pick.section && !entry.section.empty)
      : undefined;
  const activeSection: SectionKey = pickedEntry?.key ?? firstNonEmpty;
  const active = sections.find((entry) => entry.key === activeSection)!.section;

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="capsule-compare-modal-title"
        className="relative w-[min(96vw,1100px)] max-w-none"
        data-testid="capsule-compare-modal"
      >
        <div className="surface-header flex items-start justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <h2
              id="capsule-compare-modal-title"
              className="font-display text-h2 font-semibold leading-[1.2] tracking-[-0.02em] text-foreground"
            >
              {t('capsule.compare.title')}
            </h2>
            <p className="mt-1 text-body-sm leading-[1.5] text-muted">
              {t('capsule.compare.subtitle')}
            </p>
          </div>
          <IconButton
            onClick={onClose}
            tooltip={t('capsule.compare.close')}
            aria-label={t('capsule.compare.close')}
            data-testid="capsule-compare-close"
          >
            <X size={16} />
          </IconButton>
        </div>

        <div
          data-testid="capsule-compare-summary"
          className="border-b border-border/80 px-6 py-3 text-body-sm leading-[1.6] text-muted"
        >
          <div data-testid="capsule-compare-summary-language">
            {model.sameLanguage
              ? t('capsule.compare.summary.languageMatch', {
                  language: model.older.language,
                })
              : t('capsule.compare.summary.languageMismatch', {
                  older: model.older.language,
                  newer: model.newer.language,
                })}
          </div>
          <div data-testid="capsule-compare-summary-status">
            {t('capsule.compare.summary.status', {
              older: statusLabel(model.older.status),
              newer: statusLabel(model.newer.status),
            })}
          </div>
          <div data-testid="capsule-compare-summary-duration">
            {t('capsule.compare.summary.duration', {
              older: formatDuration(model.older.durationMs),
              newer: formatDuration(model.newer.durationMs),
              delta: formatDelta(model.older.durationMs, model.newer.durationMs),
            })}
          </div>
          {/* fold E — environment deltas. Each chip self-hides when the
              two sides match, so this row is empty when the run
              environment was identical. */}
          <div
            data-testid="capsule-compare-summary-environment"
            className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1"
          >
            <EnvChip
              testid="capsule-compare-summary-platform"
              differs={model.older.platform !== model.newer.platform}
              text={t('capsule.compare.summary.platform', {
                older: model.older.platform,
                newer: model.newer.platform,
              })}
            />
            <EnvChip
              testid="capsule-compare-summary-runner"
              differs={model.older.runner !== model.newer.runner}
              text={t('capsule.compare.summary.runner', {
                older: model.older.runner,
                newer: model.newer.runner,
              })}
            />
            <EnvChip
              testid="capsule-compare-summary-branch"
              differs={(model.older.gitBranch ?? '') !== (model.newer.gitBranch ?? '')}
              text={t('capsule.compare.summary.branch', {
                older: model.older.gitBranch ?? '—',
                newer: model.newer.gitBranch ?? '—',
              })}
            />
          </div>
        </div>

        {model.contentIdentical ? (
          <p
            data-testid="capsule-compare-identical"
            className="px-6 py-8 text-center text-body-sm text-muted"
          >
            {t('capsule.compare.identical')}
          </p>
        ) : (
          <>
            {/* fold A — section tab bar. */}
            <div
              role="tablist"
              aria-label={t('capsule.compare.title')}
              data-testid="capsule-compare-tabs"
              className="flex items-center gap-1 border-b border-border/80 px-4 py-2"
            >
              {sections.map(({ key, section }) => {
                const isActive = key === activeSection;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    disabled={section.empty}
                    onClick={() => setPick({ capsules, section: key })}
                    data-testid={`capsule-compare-tab-${key}`}
                    className={`rounded-md px-3 py-1 text-caption font-semibold uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    {t(`capsule.compare.section.${key}`)}
                  </button>
                );
              })}
            </div>

            {active.empty ? (
              <p
                data-testid="capsule-compare-section-empty"
                className="px-6 py-8 text-center text-body-sm text-muted"
              >
                {t('capsule.compare.section.empty')}
              </p>
            ) : (
              <>
                <div className="grid max-h-[42vh] grid-cols-2 gap-0 overflow-hidden">
                  <div className="flex flex-col border-r border-border/80">
                    <div className="border-b border-border/80 px-4 py-2 text-eyebrow font-semibold uppercase tracking-[0.16em] text-muted">
                      {t('capsule.compare.olderPane')}
                    </div>
                    <pre
                      data-testid="capsule-compare-pane-older"
                      // UX Sweep T3 — focusable scroll region so a keyboard
                      // user can Tab in and scroll long code with the arrows.
                      tabIndex={0}
                      role="region"
                      aria-label={t('capsule.compare.olderPaneRegion')}
                      className="focus-ring m-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-body-sm leading-5 text-foreground"
                    >
                      {active.olderText}
                    </pre>
                  </div>
                  <div className="flex flex-col">
                    <div className="border-b border-border/80 px-4 py-2 text-eyebrow font-semibold uppercase tracking-[0.16em] text-muted">
                      {t('capsule.compare.newerPane')}
                    </div>
                    <pre
                      data-testid="capsule-compare-pane-newer"
                      tabIndex={0}
                      role="region"
                      aria-label={t('capsule.compare.newerPaneRegion')}
                      className="focus-ring m-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-body-sm leading-5 text-foreground"
                    >
                      {active.newerText}
                    </pre>
                  </div>
                </div>

                <div className="border-t border-border/80">
                  {active.clamped ? (
                    <div
                      data-testid="capsule-compare-clamped"
                      className="border-b border-border/80 px-6 py-2 text-body-sm text-warning"
                    >
                      {t('capsule.compare.clamped', {
                        limit: DIFF_MAX_INPUT_CHARS.toLocaleString(
                          i18n.resolvedLanguage ?? i18n.language
                        ),
                      })}
                    </div>
                  ) : null}
                  <div
                    data-testid="capsule-compare-diff-list"
                    tabIndex={0}
                    role="region"
                    aria-label={t('capsule.compare.diffRegion')}
                    className="focus-ring max-h-[28vh] overflow-y-auto px-3 py-2"
                  >
                    {active.diff.map((segment, index) => (
                      <DiffLine key={index} segment={segment} />
                    ))}
                  </div>
                  {active.omittedLines > 0 ? (
                    <div
                      data-testid="capsule-compare-more-lines"
                      className="border-t border-border/80 px-6 py-2 text-body-sm text-muted"
                    >
                      {t('capsule.compare.moreLines', { count: active.omittedLines })}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </>
        )}
      </OverlayCard>
    </OverlayBackdrop>
  );
}
