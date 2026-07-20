import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { typeIcon } from './richConsoleFormat';

interface RichValueTableProps {
  payload: Extract<RichOutputPayload, { kind: 'table' }>;
}

/**
 * implementation — inline preview for `{ kind: 'table' }`. Shows a
 * compact `Table(rows×cols) — col1, col2, …` chip; the popover
 * surfaces the full table.
 *
 * Mirrors the inline-pill format from implementation's
 * `formatPayloadInlineSummary`, with the type icon hoisted into the
 * chrome so the cell reads visually identical to the inline summary
 * the user already learned in the editor overlay.
 */
export function RichValueTable({ payload }: RichValueTableProps) {
  const { t } = useTranslation();
  const rows = payload.rows.length + (payload.truncatedRowCount ?? 0);
  const cols = payload.columns.length;
  const colsLabel = payload.columns.length > 0 ? ` — ${payload.columns.join(', ')}` : '';
  const summary = t('console.rich.tableSummary', { rows, cols });
  return (
    <span className="font-mono text-foreground">
      <span className="select-none text-fg-subtle">{typeIcon(payload)} </span>
      <span className="text-info">{summary}</span>
      <span className="text-fg-subtle">{colsLabel}</span>
    </span>
  );
}
