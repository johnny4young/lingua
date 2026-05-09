import { FieldLabel, PanelSection, StatusMessage, UtilityInput } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { generateUuid } from '../../../utils/developerUtilities';
import { generateUlid, generateUuidV7, inspectIdentifier } from '../../../utils/uuid';
import type { IdentifierKind } from '../../../utils/uuid';

type UuidKind = 'v4' | 'v7' | 'ulid';

function generateIdentifier(kind: UuidKind): string {
  if (kind === 'v4') return generateUuid();
  if (kind === 'v7') return generateUuidV7();
  return generateUlid();
}

function kindLabelKey(kind: IdentifierKind): string {
  if (kind === 'uuid-v7') return 'utilities.tool.uuid.version.v7';
  if (kind === 'uuid-v4') return 'utilities.tool.uuid.version.v4';
  return 'utilities.tool.uuid.version.ulid';
}

export function UuidUtilityPanel() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<UuidKind>('v4');
  const [values, setValues] = useState<string[]>(() =>
    Array.from({ length: 3 }, () => generateIdentifier('v4'))
  );
  const [decoderInput, setDecoderInput] = useState('');
  const decoded = useMemo(() => {
    const trimmed = decoderInput.trim();
    return trimmed ? inspectIdentifier(trimmed) : null;
  }, [decoderInput]);

  const regenerate = (nextKind: UuidKind = kind) => {
    setValues(Array.from({ length: 3 }, () => generateIdentifier(nextKind)));
  };

  // RL-069 Slice 1 — the first generated identifier is the canonical
  // copyable value; users can always Regenerate to refresh it. The
  // existing per-row CopyButtons remain so a user can still grab any
  // of the three explicitly.
  const registerOutput = useCallback(() => values[0] ?? null, [values]);
  useRegisterUtilityOutput(registerOutput);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <PanelSection
        title={t('utilities.tool.uuid.title')}
        description={t('utilities.tool.uuid.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.uuid.version.label')}</FieldLabel>
          <select
            aria-label={t('utilities.tool.uuid.version.label')}
            data-testid="uuid-version-select"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as UuidKind;
              setKind(next);
              regenerate(next);
            }}
            className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          >
            <option value="v4">{t('utilities.tool.uuid.version.v4')}</option>
            <option value="v7">{t('utilities.tool.uuid.version.v7')}</option>
            <option value="ulid">{t('utilities.tool.uuid.version.ulid')}</option>
          </select>
        </div>
        <button
          type="button"
          className="button-primary w-fit"
          onClick={() => regenerate()}
        >
          {t('utilities.tool.uuid.actions.regenerate')}
        </button>
        <div className="grid gap-2">
          {values.map((value, index) => (
            <div
              key={value}
              data-testid="uuid-generated-value"
              className="flex items-center justify-between gap-2 rounded-[1rem] border border-border/80 bg-background/70 px-3 py-2 font-mono text-sm text-foreground"
            >
              <span className="truncate">{value}</span>
              <CopyButton
                value={value}
                testid={`uuid-generated-value-copy-${index}`}
              />
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.uuid.decode.title')}
        description={t('utilities.tool.uuid.decode.description')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.uuid.decode.inputLabel')}</FieldLabel>
          <UtilityInput
            aria-label={t('utilities.tool.uuid.decode.inputLabel')}
            data-testid="uuid-decoder-input"
            value={decoderInput}
            onChange={(event) => setDecoderInput(event.target.value)}
            placeholder={t('utilities.tool.uuid.decode.placeholder')}
            spellCheck={false}
          />
        </div>
        {decoderInput.trim() === '' ? (
          <StatusMessage message={t('utilities.tool.uuid.decode.idle')} />
        ) : decoded === null ? (
          <StatusMessage
            message={t('utilities.tool.uuid.decode.unrecognized')}
            tone="error"
          />
        ) : (
          <div className="grid gap-2" data-testid="uuid-decoder-result">
            <StatusMessage
              message={t('utilities.tool.uuid.decode.kind', {
                kind: t(kindLabelKey(decoded.kind)),
              })}
              tone="success"
            />
            {decoded.timestamp ? (
              <StatusMessage
                message={t('utilities.tool.uuid.decode.timestamp', {
                  value: decoded.timestamp.toISOString(),
                })}
              />
            ) : null}
          </div>
        )}
      </PanelSection>
    </div>
  );
}
