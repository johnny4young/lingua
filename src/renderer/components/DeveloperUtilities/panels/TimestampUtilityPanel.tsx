import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  TimestampHoverValue,
  UtilityInput,
  UtilityToolbar,
} from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { usePendingUtilityInput } from '../usePendingUtilityInput';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { analyzeTimestamp, inspectTimestampLike } from '../../../utils/developerUtilities';

export function TimestampUtilityPanel() {
  const { t } = useTranslation();
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  // IT2-F4 — seed from a smart-pasted epoch value.
  usePendingUtilityInput('timestamp', setInput);
  const analysis = useMemo(() => analyzeTimestamp(input), [input]);

  // RL-069 Slice 2 — ISO 8601 is the most copy-worthy output for the
  // shortcut. The other readouts (epoch s/ms, local) stay reachable
  // through their per-row CopyButtons.
  const registerOutput = useCallback(() => analysis.iso ?? null, [analysis.iso]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    // No-op for the live panel — Apply gives a deterministic moment
    // for the success toast to confirm the gesture.
    setInput(prev => prev);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <PanelSection
        title={t('utilities.tool.timestamp.title')}
        description={t('utilities.tool.timestamp.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.field.input')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.field.input')}
            value={input}
            onChange={event => setInput(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="button-secondary w-fit"
            onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}
          >
            {t('utilities.tool.timestamp.actions.useNow')}
          </button>
          <UtilityToolbar
            utilityId="timestamp"
            primary={input}
            run={runApply}
            setPrimary={setInput}
          />
        </div>
        {analysis.errorKey ? <StatusMessage message={t(analysis.errorKey)} tone="error" /> : null}
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.timestamp.outputsTitle')}
        description={t('utilities.tool.timestamp.outputsDescription')}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.seconds')}
            value={analysis.unixSeconds ?? null}
            testid="timestamp-output-seconds"
          />
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.milliseconds')}
            value={analysis.unixMilliseconds ?? null}
            testid="timestamp-output-milliseconds"
          />
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.iso')}
            value={analysis.iso ?? null}
            testid="timestamp-output-iso"
            fullWidth
          />
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.local')}
            value={analysis.local ?? null}
            testid="timestamp-output-local"
            fullWidth
            monospace={false}
          />
          <TimestampOutputCard
            label={t('utilities.tool.timestamp.outputs.utc')}
            value={analysis.utc ?? null}
            testid="timestamp-output-utc"
            fullWidth
            monospace={false}
          />
        </div>
      </PanelSection>
    </div>
  );
}

function TimestampOutputCard({
  label,
  value,
  testid,
  fullWidth = false,
  monospace = true,
}: {
  label: string;
  /** Raw value for the cell. `null` renders the placeholder and disables copy. */
  value: string | number | null;
  testid: string;
  fullWidth?: boolean;
  monospace?: boolean;
}) {
  const hasValue = value !== null && value !== undefined && String(value).length > 0;
  const stringValue = hasValue ? String(value) : '';
  const timestamp = hasValue ? inspectTimestampLike(value) : null;
  const textClass = `${monospace ? 'font-mono ' : ''}text-body text-foreground`;
  return (
    <div
      className={`grid gap-1 rounded-2xl border border-border/80 bg-background/65 px-3 py-3 ${
        fullWidth ? 'md:col-span-2' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption uppercase tracking-[0.16em] text-muted">{label}</span>
        <CopyButton value={stringValue} testid={`${testid}-copy`} disabled={!hasValue} />
      </div>
      <span className={textClass} data-testid={testid}>
        {timestamp ? (
          <TimestampHoverValue value={stringValue} timestamp={timestamp} />
        ) : hasValue ? (
          stringValue
        ) : (
          '—'
        )}
      </span>
    </div>
  );
}
