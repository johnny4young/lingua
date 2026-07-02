/**
 * Shared full-grid renderer for a `{ kind: 'table' }` rich payload.
 *
 * Extracted from the console Details popover so the console AND the
 * notebook code cell render tabular output identically (header row +
 * body rows + a truncated-row footnote). Cells are stringified via the
 * shared `scopeValueToString`.
 */

import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { scopeValueToString } from './richConsoleFormat';

interface RichTableGridProps {
  payload: Extract<RichOutputPayload, { kind: 'table' }>;
}

export function RichTableGrid({ payload }: RichTableGridProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-auto" data-testid="rich-table-grid">
      <table className="min-w-full border-collapse text-caption">
        <thead>
          <tr className="border-b border-border-subtle/60 text-fg-subtle">
            {payload.columns.map((col) => (
              <th key={col} className="px-2 py-1 text-left font-bold">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.map((row, rIdx) => (
            <tr key={rIdx} className="border-b border-border-subtle/30">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-2 py-1 align-top text-foreground">
                  {scopeValueToString(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {payload.truncatedRowCount !== undefined && (
        <p className="mt-2 text-eyebrow text-fg-subtle">
          {t('console.rich.moreCount', { count: payload.truncatedRowCount })}
        </p>
      )}
    </div>
  );
}
