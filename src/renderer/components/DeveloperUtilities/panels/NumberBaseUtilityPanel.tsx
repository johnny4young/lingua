import { FieldLabel, PanelSection, StatusMessage, UtilityInput } from '../panelPrimitives';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_BASE, MIN_BASE, formatInBase, isValidBase, parseInAnyBase } from '../../../utils/numberBase';

interface NumberBaseView {
  readonly id: 'binary' | 'octal' | 'decimal' | 'hex' | 'custom';
  readonly base: number;
  readonly labelKey: string;
  readonly testId: string;
}

const NUMBER_BASE_STATIC_VIEWS: readonly NumberBaseView[] = [
  { id: 'binary', base: 2, labelKey: 'utilities.tool.numberBase.input.binary', testId: 'number-base-input-binary' },
  { id: 'octal', base: 8, labelKey: 'utilities.tool.numberBase.input.octal', testId: 'number-base-input-octal' },
  { id: 'decimal', base: 10, labelKey: 'utilities.tool.numberBase.input.decimal', testId: 'number-base-input-decimal' },
  { id: 'hex', base: 16, labelKey: 'utilities.tool.numberBase.input.hex', testId: 'number-base-input-hex' },
];

export function NumberBaseUtilityPanel() {
  const { t } = useTranslation();
  // Single source of truth: the parsed bigint. Views derive their rendered
  // string from `value` unless the view is the one the user is currently
  // editing (tracked via `editingId`) — that way invalid transient input in
  // one view doesn't stomp the other views' formatted output.
  const [value, setValue] = useState<bigint>(255n);
  const [draft, setDraft] = useState<Record<NumberBaseView['id'], string>>({
    binary: '11111111',
    octal: '377',
    decimal: '255',
    hex: 'FF',
    custom: '',
  });
  const [editingId, setEditingId] = useState<NumberBaseView['id'] | null>(null);
  const [invalidId, setInvalidId] = useState<NumberBaseView['id'] | null>(null);
  const [customBase, setCustomBase] = useState(7);

  const views = useMemo<readonly NumberBaseView[]>(
    () => [
      ...NUMBER_BASE_STATIC_VIEWS,
      {
        id: 'custom',
        base: customBase,
        labelKey: 'utilities.tool.numberBase.input.custom',
        testId: 'number-base-input-custom',
      },
    ],
    [customBase]
  );

  const rendered = useMemo<Record<NumberBaseView['id'], string>>(() => {
    const output: Record<NumberBaseView['id'], string> = {
      binary: formatInBase(value, 2),
      octal: formatInBase(value, 8),
      decimal: formatInBase(value, 10),
      hex: formatInBase(value, 16),
      custom: isValidBase(customBase) ? formatInBase(value, customBase) : '',
    };
    if (editingId) {
      output[editingId] = draft[editingId];
    }
    return output;
  }, [value, editingId, draft, customBase]);

  const handleChange = (view: NumberBaseView, nextInput: string) => {
    setEditingId(view.id);
    setDraft((prev) => ({ ...prev, [view.id]: nextInput }));
    const parsed = parseInAnyBase(nextInput, view.base);
    if (parsed === null) {
      setInvalidId(view.id);
      return;
    }
    setInvalidId(null);
    setValue(parsed);
  };

  const handleBlur = () => {
    // On blur we exit editing mode so every view re-derives from `value`,
    // erasing any stale draft that happened to be the active one.
    setEditingId(null);
    setInvalidId(null);
  };

  return (
    <PanelSection
      title={t('utilities.tool.numberBase.title')}
      description={t('utilities.tool.numberBase.panelDescription')}
    >
      <div className="grid gap-3">
        {views.map((view) => {
          const isInvalid = invalidId === view.id;
          return (
            <div key={view.id} className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>{t(view.labelKey)}</FieldLabel>
                {view.id === 'custom' ? (
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <span>{t('utilities.tool.numberBase.customBaseLabel')}</span>
                    <input
                      type="number"
                      min={MIN_BASE}
                      max={MAX_BASE}
                      value={customBase}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (isValidBase(next)) setCustomBase(next);
                      }}
                      aria-label={t('utilities.tool.numberBase.customBaseLabel')}
                      className="w-16 rounded-[0.75rem] border border-border/80 bg-background/88 px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                    />
                  </label>
                ) : null}
              </div>
              <UtilityInput
                aria-label={t(view.labelKey)}
                data-testid={view.testId}
                value={rendered[view.id]}
                onChange={(event) => handleChange(view, event.target.value)}
                onBlur={handleBlur}
                className={
                  isInvalid
                    ? 'border-danger/70 focus:border-danger'
                    : undefined
                }
                spellCheck={false}
              />
            </div>
          );
        })}
      </div>
      {invalidId ? (
        <StatusMessage message={t('utilities.tool.numberBase.invalidInput')} tone="error" />
      ) : (
        <StatusMessage message={t('utilities.status.live')} />
      )}
    </PanelSection>
  );
}
