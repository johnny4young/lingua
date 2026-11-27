import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Copy, CornerDownLeft, FileDown, FlaskConical, GitCompare, MoreHorizontal, Share, Trash2 } from 'lucide-react';
import { useOverflowStepFit } from '../../hooks/useOverflowStepFit';
import { cn } from '../../utils/cn';
import { ProMark } from '../ui/ProChip';
import { CapsuleActionMenu, type CapsuleMenuItem } from './CapsuleActionMenu';

const SECONDARY_BUTTON =
  'focus-ring inline-flex h-[30px] shrink-0 items-center gap-[7px] rounded-lg border border-border-default px-3 text-[12.5px] font-medium text-fg-base hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60';

/** Export folds into ⋯ first, then Compare keeps only its glyph, then folds too; the last step lets the row wrap. */
const EXPORT_FOLDED = 1;
const COMPARE_GLYPH = 2;
const COMPARE_FOLDED = 3;
const WRAPS = 4;

function menuTrigger(label: string, icon?: ReactNode) {
  return (
    <>
      {icon}
      {label}
      <ChevronDown size={10} aria-hidden="true" />
    </>
  );
}

/** A menu item drawn as a button on the row; `glyphOnly` keeps its label as the name and tooltip. */
function ItemButton({ item, glyphOnly = false }: { item: CapsuleMenuItem; glyphOnly?: boolean }) {
  return (
    <button
      type="button"
      disabled={item.disabled}
      onClick={item.onSelect}
      data-testid={item.testid}
      aria-label={glyphOnly ? item.label : undefined}
      title={glyphOnly ? item.label : undefined}
      className={SECONDARY_BUTTON}
    >
      {item.icon}
      {glyphOnly ? null : item.label}
      {item.badge}
    </button>
  );
}

interface CapsuleDetailActionsProps {
  canBrowse: boolean;
  canCompare: boolean;
  onOpen: () => void;
  onCopyJson: () => void;
  onCopySummary: () => void;
  onCompare: () => void;
  onExportHtml: () => void;
  onRegression: () => void;
  onRemove: () => void;
  onPlans: () => void;
}

/** Open, Share, Compare and Export on one row; when it runs out of width ⋯ takes Export, then Compare. */
export function CapsuleDetailActions({
  canBrowse,
  canCompare,
  onOpen,
  onCopyJson,
  onCopySummary,
  onCompare,
  onExportHtml,
  onRegression,
  onRemove,
  onPlans,
}: CapsuleDetailActionsProps) {
  const { t, i18n } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const step = useOverflowStepFit(rowRef, `${i18n.language}:${canBrowse}`, WRAPS + 1);
  const exportFolded = step >= EXPORT_FOLDED;
  const compareFolded = step >= COMPARE_FOLDED;

  const exportLabel = t('capsuleList.row.export');
  const locked = { badge: <ProMark />, onSelect: onPlans };
  const compare: CapsuleMenuItem = {
    id: 'compare',
    label: t('capsuleList.compare.action'),
    icon: <GitCompare size={13} aria-hidden="true" />,
    ...(canBrowse ? { testid: 'capsule-compare-button', disabled: !canCompare, onSelect: onCompare } : { testid: 'capsule-compare-locked', ...locked }),
  };
  const exportItems: CapsuleMenuItem[] = canBrowse
    ? [
        { id: 'export-html', label: t('capsuleList.row.exportHtml'), icon: <FileDown size={13} aria-hidden="true" />, testid: 'capsule-list-row-export-html', onSelect: onExportHtml },
        { id: 'regression', label: t('capsuleRegression.action'), icon: <FlaskConical size={13} aria-hidden="true" />, testid: 'capsule-prepare-regression', onSelect: onRegression },
      ]
    : [{ id: 'export', label: exportLabel, icon: <FileDown size={13} aria-hidden="true" />, testid: 'capsule-export-locked', ...locked }];
  const moreItems: CapsuleMenuItem[] = [
    ...(compareFolded ? [compare] : []),
    ...(exportFolded ? exportItems : []),
    ...(canBrowse
      ? [{ id: 'remove', label: t('capsuleList.row.delete'), icon: <Trash2 size={13} aria-hidden="true" />, testid: 'capsule-list-row-delete', danger: true, onSelect: onRemove }]
      : []),
  ];

  return (
    <div
      ref={rowRef}
      data-testid="capsule-detail-actions"
      data-fit={step}
      className={cn('flex items-center gap-2 px-5 pt-3.5', step >= WRAPS ? 'flex-wrap' : 'flex-nowrap')}
    >
      <button type="button" onClick={onOpen} data-testid="capsule-list-row-open" className="button-primary inline-flex h-[30px] shrink-0 items-center gap-[7px] px-3">
        <CornerDownLeft size={13} aria-hidden="true" />
        {t('capsuleList.action.open')}
      </button>
      <CapsuleActionMenu
        label={t('capsuleList.action.share')}
        triggerTestId="capsule-list-share"
        triggerClassName={SECONDARY_BUTTON}
        trigger={menuTrigger(t('capsuleList.action.share'), <Share size={13} aria-hidden="true" />)}
        items={[
          { id: 'export', label: t('capsuleList.share.copyJson'), icon: <Copy size={13} aria-hidden="true" />, testid: 'capsule-list-row-export', onSelect: onCopyJson },
          { id: 'copy-summary', label: t('capsuleList.row.copySummary'), icon: <Copy size={13} aria-hidden="true" />, testid: 'capsule-list-row-copy-summary', onSelect: onCopySummary },
        ]}
      />
      {compareFolded ? null : <ItemButton item={compare} glyphOnly={step >= COMPARE_GLYPH} />}
      {exportFolded ? null : canBrowse ? (
        <CapsuleActionMenu label={exportLabel} triggerTestId="capsule-list-export" triggerClassName={SECONDARY_BUTTON} trigger={menuTrigger(exportLabel)} items={exportItems} />
      ) : (
        <ItemButton item={{ ...exportItems[0]!, icon: null }} />
      )}
      {moreItems.length > 0 ? (
        <>
          <span className="flex-1" />
          <CapsuleActionMenu
            label={t('capsuleList.action.more')}
            align="right"
            triggerTestId="capsule-list-more"
            triggerClassName="focus-ring grid size-[30px] shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base"
            trigger={<MoreHorizontal size={16} aria-hidden="true" />}
            items={moreItems}
          />
        </>
      ) : null}
    </div>
  );
}
