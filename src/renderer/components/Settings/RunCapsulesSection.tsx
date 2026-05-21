import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { trackEvent } from '../../utils/telemetry';
import {
  bucketCapsuleSize,
  sanitizeRunCapsule,
  summarizeRunCapsule,
  utf8ByteLength,
} from '../../../shared/runCapsule';
import { Row, Section } from './shared';

/**
 * RL-094 Slice 1 — Settings → Account → Run Capsules.
 *
 * Reads the latest captured `RunCapsuleV1` from the execution-history
 * store via the `latestCapsule()` selector, renders a one-line
 * summary, and offers a single Export button. On click the button:
 *
 *   1. Runs the capsule through `sanitizeRunCapsule` (truncates
 *      oversized streams + drops non-primitive `dependencySummary`
 *      shapes; records what was omitted in `privacy.omittedFields`).
 *   2. Serialises with `JSON.stringify`. Fold C exposes a pretty /
 *      minified toggle so users heading to RL-036 share-links (URL
 *      fragment) can keep the payload tight.
 *   3. Writes to the clipboard via `navigator.clipboard.writeText`,
 *      falls back to a read-only textarea exposed inline when the
 *      clipboard API rejects (Safari private mode, iframe context).
 *   4. Fires the `capsule.exported { trigger, sizeBucket }` adoption
 *      telemetry (Fold A) — closed-enum, no payload content leaks.
 *
 * No new IPC. No desktop saveDialog — Slice 1 ships pure
 * clipboard-or-inline; a future slice can promote saveDialog when
 * the IPC surface exists. The Settings copy is explicit that nothing
 * leaves the device unless the user pastes it themselves (per
 * Anti-feature §A-006: no mandatory cloud sync).
 */
export function RunCapsulesSection() {
  const { t } = useTranslation();
  // RL-094 Slice 1 reviewer fix — select the CALL RESULT of
  // `latestCapsule()`, not the function reference. The reference is
  // stable across store updates so subscribing to it would never
  // trigger a re-render when a new run lands; selecting the result
  // returns a new RunCapsuleV1 reference (or `null`) on each entries
  // change, so the component re-renders correctly. Mirrors the
  // pattern used in `CommandPalette.tsx` (RL-094 Slice 1 fold B).
  const capsule = useExecutionHistoryStore((state) => state.latestCapsule());
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);
  const [prettyPrint, setPrettyPrint] = useState(true);
  const [inlineFallback, setInlineFallback] = useState<string | null>(null);

  const summary = useMemo(
    () => (capsule ? summarizeRunCapsule(capsule) : null),
    [capsule]
  );

  const handleExport = useCallback(async () => {
    if (!capsule) return;
    const sanitised = sanitizeRunCapsule(capsule);
    const json = prettyPrint
      ? JSON.stringify(sanitised, null, 2)
      : JSON.stringify(sanitised);
    const trigger = 'settings-export' as const;
    const sizeBucket = bucketCapsuleSize(utf8ByteLength(json));
    void trackEvent('capsule.exported', { trigger, sizeBucket });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        pushStatusNotice({
          tone: 'success',
          messageKey: 'settings.account.runCapsules.copiedNotice',
        });
        setInlineFallback(null);
        return;
      }
      throw new Error('clipboard-unavailable');
    } catch {
      // Fall back to inline textarea — user can Cmd+A + Cmd+C from it.
      setInlineFallback(json);
      pushStatusNotice({
        tone: 'warning',
        messageKey: 'settings.account.runCapsules.fallbackNotice',
      });
    }
  }, [capsule, prettyPrint, pushStatusNotice]);

  return (
    <Section
      title={t('settings.account.runCapsules.title')}
      description={t('settings.account.runCapsules.description')}
    >
      <Row
        label={t('settings.account.runCapsules.latestRun')}
        hint={
          summary ?? t('settings.account.runCapsules.emptyState')
        }
      >
        <div className="grid w-full gap-2 text-right">
          <label className="flex items-center justify-end gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={prettyPrint}
              onChange={(event) => setPrettyPrint(event.target.checked)}
              data-testid="capsule-pretty-toggle"
            />
            {t('settings.account.runCapsules.prettyToggle')}
          </label>
          <button
            type="button"
            className="button-primary justify-self-end"
            onClick={handleExport}
            disabled={!capsule}
            data-testid="capsule-export-button"
          >
            {t('settings.account.runCapsules.exportButton')}
          </button>
        </div>
      </Row>
      {inlineFallback !== null ? (
        <Row
          label={t('settings.account.runCapsules.fallbackLabel')}
          hint={t('settings.account.runCapsules.fallbackHint')}
        >
          <textarea
            readOnly
            value={inlineFallback}
            rows={6}
            className="w-full rounded-md border border-border/60 bg-bg-elevated p-2 font-mono text-xs"
            data-testid="capsule-fallback-textarea"
            onFocus={(event) => event.currentTarget.select()}
          />
        </Row>
      ) : null}
    </Section>
  );
}
