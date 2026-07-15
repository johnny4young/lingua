import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useUIStore } from '../../stores/uiStore';
import { summarizeRunCapsule } from '../../../shared/runCapsule';
import { exportCapsuleToClipboard } from '../../utils/exportCapsule';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { emitCommand } from '../../stores/commandBus';

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
  const capsule = useExecutionHistoryStore(state => state.latestCapsule());
  const pushStatusNotice = useUIStore(state => state.pushStatusNotice);
  const [prettyPrint, setPrettyPrint] = useState(true);
  const [inlineFallback, setInlineFallback] = useState<string | null>(null);

  const summary = useMemo(() => (capsule ? summarizeRunCapsule(capsule) : null), [capsule]);

  const handleExport = useCallback(async () => {
    if (!capsule) return;
    const result = await exportCapsuleToClipboard(capsule, 'settings-export', {
      pretty: prettyPrint,
    });
    if (result.ok) {
      pushStatusNotice({
        tone: 'success',
        messageKey: 'settings.account.runCapsules.copiedNotice',
      });
      setInlineFallback(null);
      return;
    }
    // Fall back to inline textarea — user can Cmd+A + Cmd+C from it.
    // This is the Settings-specific fallback; the palette + result-panel
    // surfaces redirect the user back to Settings via a different notice.
    setInlineFallback(result.json);
    pushStatusNotice({
      tone: 'warning',
      messageKey: 'settings.account.runCapsules.fallbackNotice',
    });
  }, [capsule, prettyPrint, pushStatusNotice]);

  return (
    <SettingsSection
      eyebrow={t('settings.account.runCapsules.title')}
      description={t('settings.account.runCapsules.description')}
    >
      <SpecCard>
        <SpecRow
          last={inlineFallback === null}
          label={t('settings.account.runCapsules.latestRun')}
          description={summary ?? t('settings.account.runCapsules.emptyState')}
          control={
            <div className="flex flex-col items-end gap-2">
              <label className="flex items-center gap-2 text-caption text-fg-subtle">
                <input
                  type="checkbox"
                  checked={prettyPrint}
                  onChange={event => setPrettyPrint(event.target.checked)}
                  data-testid="capsule-pretty-toggle"
                />
                {t('settings.account.runCapsules.prettyToggle')}
              </label>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/*
                 * RL-094 Slice 2 — Import button mirrors the Export
                 * affordance so the surface advertises both directions of
                 * the capsule loop. Click emits a command the App-level
                 * overlay consumer handles; this keeps the
                 * Settings section decoupled from the overlay state
                 * slot (same pattern as the snippets surface).
                 */}
                {/*
                 * RL-094 Slice 3 — Browse opens the Pro-gated capsule
                 * browse overlay. Same typed-command decoupling as Import;
                 * the surface tag drives the overlay's
                 * `capsule.browse_opened` telemetry.
                 */}
                <button
                  type="button"
                  className="rounded-md border border-border-default px-3 py-1.5 text-body-sm text-fg-base transition-colors hover:bg-bg-panel-alt"
                  onClick={() => {
                    emitCommand('capsule.openList', { surface: 'settings' });
                  }}
                  data-testid="capsule-browse-button"
                  title={t('settings.account.runCapsules.browse.helper')}
                >
                  {t('settings.account.runCapsules.browse.button')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border-default px-3 py-1.5 text-body-sm text-fg-base transition-colors hover:bg-bg-panel-alt"
                  onClick={() => {
                    emitCommand('capsule.openImport');
                  }}
                  data-testid="capsule-import-button"
                  title={t('settings.account.runCapsules.import.helper')}
                >
                  {t('settings.account.runCapsules.import.button')}
                </button>
                <button
                  type="button"
                  className="button-primary"
                  onClick={handleExport}
                  disabled={!capsule}
                  data-testid="capsule-export-button"
                >
                  {t('settings.account.runCapsules.exportButton')}
                </button>
              </div>
            </div>
          }
        />
        {inlineFallback !== null ? (
          <SpecRow
            last
            label={t('settings.account.runCapsules.fallbackLabel')}
            description={t('settings.account.runCapsules.fallbackHint')}
            control={
              <textarea
                readOnly
                value={inlineFallback}
                rows={6}
                className="w-full max-w-[320px] rounded-md border border-border-default bg-bg-base p-2 font-mono text-body-sm text-fg-base"
                data-testid="capsule-fallback-textarea"
                onFocus={event => event.currentTarget.select()}
              />
            }
          />
        ) : null}
      </SpecCard>
    </SettingsSection>
  );
}
