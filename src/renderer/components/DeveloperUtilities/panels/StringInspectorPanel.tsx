import { FieldLabel, PanelSection, StatusMessage, UtilityTextarea, UtilityToolbar } from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { formatNumber } from '../../../i18n/formatNumber';
import { inspect as inspectString } from '../../../utils/stringInspector';
import type { CharacterCategory, WarningKind } from '../../../utils/stringInspector';

export function StringInspectorPanel() {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState('hello\u200Bworld');
  const report = useMemo(() => inspectString(input), [input]);

  // RL-069 Slice 2 \u2014 the panel's value is its analysis; the canonical
  // copyable output is a one-line summary "Nx graphemes \u00B7 Mx UTF-16 \u00B7
  // Bx bytes" so a quick Cmd+Shift+C lands the headline numbers in
  // the clipboard.
  const registerOutput = useCallback(() => {
    if (input.length === 0) return null;
    return `${report.counts.graphemesApprox} graphemes \u00B7 ${report.counts.charactersUtf16} UTF-16 \u00B7 ${report.counts.bytesUtf8} bytes`;
  }, [input, report.counts]);
  useRegisterUtilityOutput(registerOutput);

  const runApply = useCallback(() => {
    setInput((prev) => prev);
  }, []);

  return (
    <div className="grid gap-4">
      <PanelSection
        title={t('utilities.tool.stringInspector.title')}
        description={t('utilities.tool.stringInspector.panelDescription')}
      >
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.stringInspector.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.stringInspector.input.label')}
            data-testid="string-inspector-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <InspectorCountCard
            label={t('utilities.tool.stringInspector.summary.graphemes')}
            value={report.counts.graphemesApprox}
            testid="string-inspector-graphemes"
            language={i18n.language}
          />
          <InspectorCountCard
            label={t('utilities.tool.stringInspector.summary.utf16')}
            value={report.counts.charactersUtf16}
            testid="string-inspector-utf16"
            language={i18n.language}
          />
          <InspectorCountCard
            label={t('utilities.tool.stringInspector.summary.utf8Bytes')}
            value={report.counts.bytesUtf8}
            testid="string-inspector-utf8"
            language={i18n.language}
          />
        </div>
        <UtilityToolbar
          utilityId="string-inspector"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      {report.warnings.length > 0 ? (
        <PanelSection
          title={t('utilities.tool.stringInspector.warnings.title')}
          description={t('utilities.tool.stringInspector.warnings.description')}
        >
          <ul className="grid gap-1" data-testid="string-inspector-warnings">
            {report.warnings.map((warning) => (
              <li
                key={warning.kind}
                data-testid={`string-inspector-warning-${warning.kind}`}
                className="rounded-xl border border-warning/60 bg-warning/10 px-3 py-2 text-body-sm text-warning"
              >
                {t(warningKeyForKind(warning.kind), { count: warning.at.length })}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <PanelSection
        title={t('utilities.tool.stringInspector.table.title')}
        description={t('utilities.tool.stringInspector.table.description')}
      >
        {report.characters.length === 0 ? (
          <StatusMessage message={t('utilities.tool.stringInspector.table.empty')} />
        ) : (
          <div
            className="max-h-[26rem] overflow-auto rounded-2xl border border-border/80 bg-background/65"
            data-testid="string-inspector-table"
          >
            <table className="w-full border-collapse text-body-sm">
              <thead className="sticky top-0 bg-surface/88 text-caption uppercase tracking-[0.16em] text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.index')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.glyph')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.codepoint')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('utilities.tool.stringInspector.column.category')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.characters.map((row) => (
                  <tr
                    key={row.index}
                    data-testid="string-inspector-row"
                    data-category={row.category}
                    className="border-t border-border/60 font-mono"
                  >
                    <td className="px-3 py-1 tabular-nums text-muted">{row.index}</td>
                    <td className="px-3 py-1 text-foreground">{row.glyph}</td>
                    <td className="px-3 py-1 tabular-nums text-foreground">{row.hex}</td>
                    <td className="px-3 py-1 text-muted">
                      {t(categoryKey(row.category))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.truncated ? (
          <StatusMessage
            tone="muted"
            message={t('utilities.tool.stringInspector.truncated', {
              count: report.characters.length,
            })}
          />
        ) : null}
      </PanelSection>
    </div>
  );
}

function InspectorCountCard({
  label,
  value,
  testid,
  language,
}: {
  label: string;
  value: number;
  testid: string;
  language: string;
}) {
  return (
    <div className="grid gap-1 rounded-2xl border border-border/80 bg-background/65 px-3 py-3">
      <span className="text-caption uppercase tracking-[0.16em] text-muted">{label}</span>
      <span className="font-mono text-body text-foreground" data-testid={testid}>
        {formatNumber(value, language)}
      </span>
    </div>
  );
}

function warningKeyForKind(kind: WarningKind): string {
  return `utilities.tool.stringInspector.warning.${kind === 'zero-width' ? 'zeroWidth' : kind === 'bidi-control' ? 'bidiControl' : kind === 'mixed-script' ? 'mixedScript' : 'homoglyph'}`;
}

function categoryKey(category: CharacterCategory): string {
  return `utilities.tool.stringInspector.category.${category}`;
}
