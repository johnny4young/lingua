import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityTextarea,
  UtilityToolbar,
} from '../panelPrimitives';
import { JsonSyntaxOutput } from '../JsonSyntaxOutput';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import {
  JSON_CSV_DELIMITERS,
  JSON_CSV_MAX_KB,
  convertCsvToJson,
  convertJsonToCsv,
} from '../../../utils/jsonCsv';
import { detectsAsJson } from '../../../utils/developerUtilities';
import type { CsvToJsonResult, JsonCsvDelimiter, JsonToCsvResult } from '../../../utils/jsonCsv';

type JsonCsvMode = 'json-to-csv' | 'csv-to-json';

const DEFAULT_JSON_CSV_JSON_SAMPLE = `[
  {"name": "Alice", "score": 92},
  {"name": "Bob", "score": 87},
  {"name": "Carol", "score": 78}
]`;

const DEFAULT_JSON_CSV_CSV_SAMPLE = `name,score\nAlice,92\nBob,87\nCarol,78`;

const JSON_CSV_DELIMITER_KEYS: Record<JsonCsvDelimiter, string> = {
  ',': 'utilities.tool.jsonCsv.delimiter.comma',
  '\t': 'utilities.tool.jsonCsv.delimiter.tab',
  ';': 'utilities.tool.jsonCsv.delimiter.semicolon',
  '|': 'utilities.tool.jsonCsv.delimiter.pipe',
};

export function JsonCsvPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<JsonCsvMode>('json-to-csv');
  const [delimiter, setDelimiter] = useState<JsonCsvDelimiter>(',');
  const [includeHeader, setIncludeHeader] = useState(true);
  const [jsonInput, setJsonInput] = useState(DEFAULT_JSON_CSV_JSON_SAMPLE);
  const [csvInput, setCsvInput] = useState(DEFAULT_JSON_CSV_CSV_SAMPLE);

  const jsonResult: JsonToCsvResult = useMemo(
    () => convertJsonToCsv(jsonInput, { delimiter, includeHeader }),
    [jsonInput, delimiter, includeHeader]
  );
  const csvResult: CsvToJsonResult = useMemo(
    () => convertCsvToJson(csvInput, { delimiter, includeHeader }),
    [csvInput, delimiter, includeHeader]
  );

  const isJsonToCsv = mode === 'json-to-csv';
  const input = isJsonToCsv ? jsonInput : csvInput;
  const setInput = isJsonToCsv ? setJsonInput : setCsvInput;
  const result = isJsonToCsv ? jsonResult : csvResult;

  const registerOutput = useCallback(() => (result.ok ? result.output : null), [result]);
  useRegisterUtilityOutput(registerOutput);

  // Apply auto-flips direction based on input shape: JSON → CSV.
  const runApply = useCallback(() => {
    if (detectsAsJson(input)) {
      setJsonInput(input);
      setMode('json-to-csv');
      return;
    }
    setCsvInput(input);
    setMode('csv-to-json');
  }, [input]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
      <PanelSection
        title={t('utilities.tool.jsonCsv.title')}
        description={t('utilities.tool.jsonCsv.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.jsonCsv.mode.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.jsonCsv.mode.label')}
              data-testid="json-csv-mode"
              value={mode}
              onChange={event => setMode(event.target.value as JsonCsvMode)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              <option value="json-to-csv">{t('utilities.tool.jsonCsv.mode.jsonToCsv')}</option>
              <option value="csv-to-json">{t('utilities.tool.jsonCsv.mode.csvToJson')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-body-sm text-muted">
            <FieldLabel>{t('utilities.tool.jsonCsv.delimiter.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.jsonCsv.delimiter.label')}
              data-testid="json-csv-delimiter"
              value={delimiter}
              onChange={event => setDelimiter(event.target.value as JsonCsvDelimiter)}
              className="rounded-2xl border border-border/80 bg-background/88 px-3 py-2.5 text-body text-foreground outline-none focus:border-primary/50"
            >
              {JSON_CSV_DELIMITERS.map(value => (
                <option key={value} value={value}>
                  {t(JSON_CSV_DELIMITER_KEYS[value])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-body text-foreground">
          <input
            type="checkbox"
            data-testid="json-csv-header"
            checked={includeHeader}
            onChange={event => setIncludeHeader(event.target.checked)}
          />
          <span>{t('utilities.tool.jsonCsv.header.label')}</span>
        </label>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.jsonCsv.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.jsonCsv.input.label')}
            data-testid="json-csv-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            spellCheck={false}
            className="min-h-[16rem] font-mono"
          />
        </div>
        <UtilityToolbar utilityId="json-csv" primary={input} run={runApply} setPrimary={setInput} />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.jsonCsv.output.label')}
        description={t('utilities.status.live')}
      >
        {!result.ok ? (
          <StatusMessage
            message={t(result.errorKey, { limitKb: JSON_CSV_MAX_KB })}
            tone={result.errorKey === 'utilities.tool.jsonCsv.error.empty' ? 'muted' : 'error'}
            testid="json-csv-error"
          />
        ) : (
          <div className="grid gap-2">
            <StatusMessage
              tone="muted"
              testid="json-csv-summary"
              message={t('utilities.tool.jsonCsv.summary', {
                rows: result.rowCount,
                columns: result.columnCount,
              })}
            />
            <div className="relative">
              {isJsonToCsv ? (
                <UtilityTextarea
                  aria-label={t('utilities.tool.jsonCsv.output.label')}
                  data-testid="json-csv-output"
                  value={result.output}
                  readOnly
                  spellCheck={false}
                  className="pr-10 min-h-[20rem] font-mono"
                />
              ) : (
                <JsonSyntaxOutput
                  ariaLabel={t('utilities.tool.jsonCsv.output.label')}
                  testid="json-csv-output"
                  value={result.output}
                  className="min-h-[20rem] pr-10"
                />
              )}
              <div className="absolute right-2 top-2">
                <CopyButton
                  value={result.output}
                  testid="json-csv-output-copy"
                  disabled={!result.output}
                />
              </div>
            </div>
          </div>
        )}
      </PanelSection>
    </div>
  );
}
