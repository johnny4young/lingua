import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';

/**
 * RL-094 Slice 1.5 — primary surface for "Export latest run as
 * capsule". Icon-only button mounted in the result-panel header
 * next to `RecentRunsPill` + the `hideUndefined` toggle so the
 * action lives ONE click from the result the user is looking at,
 * not buried in Settings → Account.
 *
 * Settings + command palette remain as secondary surfaces (audit
 * + power-user) — same split as the auto-log toggle: preference
 * in Settings, per-tab action in the floating action pill.
 *
 * Design choices:
 *
 *   - **Lazy render to `null` when no capsule exists.** Slice 1
 *     stash on `executionHistoryStore.lastCapsule?` is `undefined`
 *     for fresh sessions; surfacing a disabled button would
 *     advertise an action that doesn't exist. Hiding it keeps the
 *     header honest about what's possible right now.
 *   - **Fold C — Pro badge for rich-media capsules.** When the
 *     capsule carries `richOutputs` (chart / image / html / table),
 *     a small badge dot signals that the exported JSON contains
 *     payloads that downstream consumers (RL-036 share-link
 *     preview, RL-098 CLI render) treat as Pro-gated for full
 *     reproducibility. Free tier can still export — the badge is
 *     informational, not a gate.
 *   - **Fold D — 1-second visual feedback on click.** Clipboard
 *     write is fire-and-forget; without an immediate visual cue
 *     the user double-clicks. Swap the `Package` icon for a
 *     `Check` for 1s then revert. Same pattern as the existing
 *     `<CopyButton>`.
 *   - **Fold F — clipboard-rejected fallback points to Settings.**
 *     The Settings surface has the inline textarea fallback (Slice
 *     1); here we push a status notice with `clipboardUnavailable`
 *     copy that points the user to Settings so the dead-end is
 *     closed.
 */

const FEEDBACK_RESET_MS = 1000;

export function RunCapsuleExportButton() {
  const { t } = useTranslation();
  const capsule = useExecutionHistoryStore((state) => state.latestCapsule());
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);
  const [justCopied, setJustCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cleanup the feedback timer if the component unmounts mid-cycle.
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const handleClick = useCallback(async () => {
    // Defensive guard: the component returns `null` below when `capsule`
    // is missing, so the button cannot be clicked in that state — but
    // keeping this branch makes the helper contract self-evident for
    // future refactors (e.g. surfacing the button in disabled form
    // instead of unmounting).
    if (!capsule) return;
    const result = await exportCapsuleToClipboard(
      capsule,
      'result-panel-export'
    );
    if (result.ok) {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'settings.account.runCapsules.copiedNotice',
      });
      setJustCopied(true);
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setJustCopied(false);
        resetTimerRef.current = null;
      }, FEEDBACK_RESET_MS);
      return;
    }
    pushStatusNotice({
      tone: 'warning',
      messageKey: 'results.actions.exportCapsule.clipboardUnavailable',
    });
  }, [capsule, pushStatusNotice]);

  if (!capsule) return null;

  const hasRichOutputs =
    Array.isArray(capsule.result.richOutputs) &&
    capsule.result.richOutputs.length > 0;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={t('results.actions.exportCapsule.tooltip')}
      aria-label={t('results.actions.exportCapsule.aria')}
      data-testid="result-panel-export-capsule"
      data-just-copied={justCopied ? 'true' : 'false'}
      data-has-rich-outputs={hasRichOutputs ? 'true' : 'false'}
      className={`relative button-secondary inline-flex items-center justify-center px-2 py-1 ${
        justCopied
          ? 'ring-2 ring-primary/60 ring-offset-1 ring-offset-bg-panel-alt'
          : ''
      }`}
    >
      {justCopied ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Package size={13} aria-hidden="true" />
      )}
      {hasRichOutputs && !justCopied ? (
        <span
          aria-hidden="true"
          data-testid="result-panel-export-pro-badge"
          title={t('results.actions.exportCapsule.proBadge')}
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary"
        />
      ) : null}
    </button>
  );
}
