import {
  FieldLabel,
  PanelSection,
  StatusMessage,
  UtilityTextarea,
  UtilityToolbar,
} from '../panelPrimitives';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterUtilityOutput } from '../../../hooks/useRegisterUtilityOutput';
import { CopyButton } from '../CopyButton';
import { YAML_JSON_INDENTS, convertJsonToYaml, convertYamlToJson } from '../../../utils/yamlJson';
import { detectsAsJson } from '../../../utils/developerUtilities';
import type { JsonToYamlResult, YamlJsonIndent, YamlToJsonResult } from '../../../utils/yamlJson';

type YamlJsonMode = 'yaml-to-json' | 'json-to-yaml';

const DEFAULT_YAML_SAMPLE = `name: lingua
version: 0.2.1
services:
  - editor
  - runner
# a comment`;

const DEFAULT_JSON_SAMPLE = `{
  "name": "lingua",
  "version": "0.2.1",
  "services": ["editor", "runner"]
}`;

export function YamlJsonPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<YamlJsonMode>('yaml-to-json');
  const [indent, setIndent] = useState<YamlJsonIndent>(2);
  const [yamlInput, setYamlInput] = useState(DEFAULT_YAML_SAMPLE);
  const [jsonInput, setJsonInput] = useState(DEFAULT_JSON_SAMPLE);

  const yamlResult: YamlToJsonResult = useMemo(
    () => convertYamlToJson(yamlInput, { indent }),
    [yamlInput, indent]
  );
  const jsonResult: JsonToYamlResult = useMemo(
    () => convertJsonToYaml(jsonInput, { indent }),
    [jsonInput, indent]
  );

  const isYamlToJson = mode === 'yaml-to-json';
  const input = isYamlToJson ? yamlInput : jsonInput;
  const setInput = isYamlToJson ? setYamlInput : setJsonInput;
  const result = isYamlToJson ? yamlResult : jsonResult;

  const registerOutput = useCallback(() => (result.ok ? result.output : null), [result]);
  useRegisterUtilityOutput(registerOutput);

  // Apply auto-flips direction based on input shape: JSON → YAML.
  const runApply = useCallback(() => {
    if (detectsAsJson(input)) {
      setJsonInput(input);
      setMode('json-to-yaml');
      return;
    }
    setYamlInput(input);
    setMode('yaml-to-json');
  }, [input]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(28rem,1.25fr)] 2xl:grid-cols-[minmax(20rem,0.8fr)_minmax(34rem,1.45fr)]">
      <PanelSection
        title={t('utilities.tool.yamlJson.title')}
        description={t('utilities.tool.yamlJson.panelDescription')}
      >
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.yamlJson.mode.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.yamlJson.mode.label')}
              data-testid="yaml-json-mode"
              value={mode}
              onChange={event => setMode(event.target.value as YamlJsonMode)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              <option value="yaml-to-json">{t('utilities.tool.yamlJson.mode.yamlToJson')}</option>
              <option value="json-to-yaml">{t('utilities.tool.yamlJson.mode.jsonToYaml')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">
            <FieldLabel>{t('utilities.tool.yamlJson.indent.label')}</FieldLabel>
            <select
              aria-label={t('utilities.tool.yamlJson.indent.label')}
              data-testid="yaml-json-indent"
              value={indent}
              onChange={event => setIndent(Number(event.target.value) as YamlJsonIndent)}
              className="rounded-[1.05rem] border border-border/80 bg-background/88 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              {YAML_JSON_INDENTS.map(value => (
                <option key={value} value={value}>
                  {value === 2
                    ? t('utilities.tool.yamlJson.indent.two')
                    : t('utilities.tool.yamlJson.indent.four')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-2">
          <FieldLabel>{t('utilities.tool.yamlJson.input.label')}</FieldLabel>
          <UtilityTextarea
            aria-label={t('utilities.tool.yamlJson.input.label')}
            data-testid="yaml-json-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            spellCheck={false}
            className="min-h-[16rem] font-mono"
          />
        </div>
        <UtilityToolbar
          utilityId="yaml-json"
          primary={input}
          run={runApply}
          setPrimary={setInput}
        />
      </PanelSection>

      <PanelSection
        title={t('utilities.tool.yamlJson.output.label')}
        description={t('utilities.status.live')}
      >
        {!result.ok ? (
          <StatusMessage
            message={t(result.errorKey)}
            tone={result.errorKey === 'utilities.tool.yamlJson.error.empty' ? 'muted' : 'error'}
            testid="yaml-json-error"
          />
        ) : (
          <div className="grid gap-2">
            {isYamlToJson && (yamlResult as { hadComments?: boolean }).hadComments ? (
              <StatusMessage
                tone="warning"
                testid="yaml-json-comments-dropped"
                message={t('utilities.tool.yamlJson.commentsDropped')}
              />
            ) : null}
            <div className="relative">
              <UtilityTextarea
                aria-label={t('utilities.tool.yamlJson.output.label')}
                data-testid="yaml-json-output"
                value={result.output}
                readOnly
                spellCheck={false}
                className="pr-10 min-h-[20rem] font-mono"
              />
              <div className="absolute right-2 top-2">
                <CopyButton
                  value={result.output}
                  testid="yaml-json-output-copy"
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
