import { Lightbulb } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { findDeveloperUtility, type DeveloperUtilityId } from '../../data/developerUtilities';
import { DotLeader } from '../ui/answer';
import type { LauncherPreview } from './launcherPreviews';
import { prefetchUtilityPanel } from './UtilityPanelRegistry';
import { UTILITY_ICON } from './utilityIcons';
import './utilityLauncher.css';

interface UtilityLauncherRowProps {
  utilityId: DeveloperUtilityId;
  selected: boolean;
  testId: string;
  onSelect: (utilityId: DeveloperUtilityId) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Dropped on the open tool's row: its panel already answers. */
  preview?: LauncherPreview | null;
  suggested?: boolean;
  /** Pin, unpin or drag controls, shown over the row's end on hover or focus. */
  actions?: ReactNode;
}

/** One tool row: glyph, name, and the answer the tool would give, joined by a dot leader. */
export function UtilityLauncherRow({
  utilityId,
  selected,
  testId,
  onSelect,
  onKeyDown,
  preview,
  suggested = false,
  actions,
}: UtilityLauncherRowProps) {
  const { t } = useTranslation();
  const definition = findDeveloperUtility(utilityId);
  const Icon = UTILITY_ICON[utilityId];
  const shown = selected ? null : preview;
  return (
    <div className="launcher-row" data-selected={selected || undefined}>
      <button
        type="button"
        data-utility-id={utilityId}
        className="launcher-row-main"
        aria-pressed={selected}
        data-testid={testId}
        title={t(definition.descriptionKey)}
        onClick={() => onSelect(utilityId)}
        onKeyDown={onKeyDown}
        onMouseEnter={() => prefetchUtilityPanel(utilityId)}
        onFocus={() => prefetchUtilityPanel(utilityId)}
      >
        <Icon size={14} strokeWidth={1.6} aria-hidden className="launcher-row-icon" />
        <span className="launcher-row-name">{t(definition.titleKey)}</span>
        {suggested ? (
          <Lightbulb
            size={12}
            role="img"
            aria-label={t('utilities.clipboard.suggested')}
            data-testid={`utility-suggested-${utilityId}`}
            className="shrink-0 text-warning-fg"
          />
        ) : null}
        {shown ? (
          <>
            <DotLeader className="launcher-row-leader" />
            <span className="launcher-row-preview value-tone" data-tone={shown.tone === 'neutral' ? undefined : shown.tone} data-testid={`utility-preview-${utilityId}`}>
              {shown.qr ? <QrGlyph /> : null}
              {shown.swatch ? <span aria-hidden className="launcher-row-swatch" style={{ background: shown.swatch }} /> : null}
              {shown.text}
            </span>
          </>
        ) : null}
      </button>
      {actions ? <span className="launcher-row-actions">{actions}</span> : null}
    </div>
  );
}

const QR_CELLS = [
  [0, 0], [2, 0], [4, 0], [8, 0], [10, 0], [12, 0], [0, 2], [4, 2], [8, 2], [12, 2], [0, 4], [2, 4], [4, 4],
  [8, 4], [12, 4], [6, 6], [10, 6], [0, 8], [4, 8], [6, 8], [8, 8], [12, 8], [2, 10], [6, 10], [10, 10],
  [12, 10], [0, 12], [2, 12], [4, 12], [8, 12], [10, 12],
] as const;

function QrGlyph() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className="launcher-row-qr">
      {QR_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2" />
      ))}
    </svg>
  );
}
