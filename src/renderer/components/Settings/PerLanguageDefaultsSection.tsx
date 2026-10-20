import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { Select, Toggle } from './shared';
import { SettingsSection, SpecCard } from '../ui/SpecRow';
import {
  WORKFLOW_MODES,
  defaultWorkflowMode,
  type WorkflowMode,
} from '../../../shared/workflowMode';
import { supportsWorkflowModeInShell } from '../../utils/workflowModeSupport';
import {
  RUNTIME_TIMEOUT_PRESETS,
  RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES,
  defaultRuntimeTimeoutPreset,
  type RuntimeTimeoutPreset,
} from '../../../shared/runtimeTimeoutPresets';

/** Workflow and auto-log defaults exist for the in-process languages only. */
const IN_PROCESS_LANGUAGES = ['javascript', 'typescript', 'python'] as const;
type InProcessLanguage = (typeof IN_PROCESS_LANGUAGES)[number];

const isInProcess = (language: string): language is InProcessLanguage =>
  (IN_PROCESS_LANGUAGES as readonly string[]).includes(language);

/** One grid for the per-language workflow, auto-log and timeout defaults; rows follow the timeout languages. */
export function PerLanguageDefaultsSection() {
  const { t } = useTranslation();
  const workflowModeDefaultsByLanguage = useSettingsStore(
    state => state.workflowModeDefaultsByLanguage
  );
  const setWorkflowModeDefault = useSettingsStore(state => state.setWorkflowModeDefault);
  const scratchpadAutoLogByLanguage = useSettingsStore(state => state.scratchpadAutoLogByLanguage);
  const setScratchpadAutoLogDefault = useSettingsStore(state => state.setScratchpadAutoLogDefault);
  const runtimeTimeoutPresetByLanguage = useSettingsStore(
    state => state.runtimeTimeoutPresetByLanguage
  );
  const setRuntimeTimeoutPreset = useSettingsStore(state => state.setRuntimeTimeoutPreset);

  const columns = [
    t('settings.perLanguage.column.workflow'),
    t('settings.perLanguage.column.autoLog'),
    t('settings.perLanguage.column.timeout'),
  ] as const;
  const cellLabel = (column: string, language: string) =>
    t('settings.perLanguage.cell', { column, language });
  const none = (column: string, language: string) => (
    <span className="text-body-sm text-fg-subtle" title={t('settings.perLanguage.none')}>
      <span aria-hidden>—</span>
      <span className="sr-only">
        {cellLabel(column, language)}: {t('settings.perLanguage.none')}
      </span>
    </span>
  );

  return (
    <div
      data-settings-search-target="editor-per-language"
      tabIndex={-1}
      className="scroll-mt-5 rounded-lg outline-none focus:ring-2 focus:ring-accent/70 focus:ring-offset-4 focus:ring-offset-bg-base"
    >
      <SettingsSection
        eyebrow={t('settings.perLanguage.title')}
        description={t('settings.perLanguage.description')}
        chip={t('settings.perLanguage.chip')}
      >
        {/* Scrolls sideways at 200% zoom instead of squeezing the selects. */}
        <SpecCard className="overflow-x-auto">
          <div
            role="table"
            aria-label={t('settings.perLanguage.title')}
            data-testid="settings-per-language-defaults"
            className="grid min-w-[560px] grid-cols-[120px_repeat(3,minmax(9rem,1fr))] items-center gap-x-4 gap-y-1.5 py-3"
          >
            <div role="row" className="contents">
              <span role="columnheader">
                <span className="sr-only">{t('settings.perLanguage.column.language')}</span>
              </span>
              {columns.map(column => (
                <span
                  key={column}
                  role="columnheader"
                  className="font-mono text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-subtle"
                >
                  {column}
                </span>
              ))}
            </div>
            {RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES.map(language => {
              const name = t(`workflowMode.languageLabel.${language}`);
              const timeout: RuntimeTimeoutPreset =
                runtimeTimeoutPresetByLanguage[language] ?? defaultRuntimeTimeoutPreset(language);
              return (
                <div key={language} role="row" className="contents">
                  <span role="rowheader" className="text-body font-medium text-fg-base">
                    {name}
                  </span>
                  <span role="cell" className="min-h-[30px] content-center">
                    {isInProcess(language) ? (
                      <Select
                        value={
                          workflowModeDefaultsByLanguage[language] ?? defaultWorkflowMode(language)
                        }
                        data-testid={`settings-workflow-mode-default-${language}`}
                        aria-label={cellLabel(columns[0], name)}
                        onChange={event =>
                          setWorkflowModeDefault(language, event.target.value as WorkflowMode)
                        }
                      >
                        {WORKFLOW_MODES.filter(mode =>
                          supportsWorkflowModeInShell(language, mode)
                        ).map(mode => (
                          <option key={mode} value={mode}>
                            {t(`workflowMode.${mode}.label`)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      none(columns[0], name)
                    )}
                  </span>
                  <span role="cell" className="min-h-[30px] content-center">
                    {isInProcess(language) ? (
                      <Toggle
                        value={scratchpadAutoLogByLanguage[language] === true}
                        onChange={() =>
                          setScratchpadAutoLogDefault(
                            language,
                            scratchpadAutoLogByLanguage[language] !== true
                          )
                        }
                        aria-label={cellLabel(columns[1], name)}
                        data-testid={`settings-auto-log-default-${language}`}
                      />
                    ) : (
                      none(columns[1], name)
                    )}
                  </span>
                  <span role="cell" className="min-h-[30px] content-center">
                    <Select
                      value={timeout}
                      data-testid={`settings-runtime-timeout-preset-${language}`}
                      aria-label={cellLabel(columns[2], name)}
                      onChange={event =>
                        setRuntimeTimeoutPreset(
                          language,
                          event.target.value as RuntimeTimeoutPreset
                        )
                      }
                    >
                      {RUNTIME_TIMEOUT_PRESETS.map(preset => (
                        <option key={preset} value={preset}>
                          {t(`runtime.timeout.preset.${preset}.label`)}
                        </option>
                      ))}
                    </Select>
                  </span>
                </div>
              );
            })}
          </div>
        </SpecCard>
      </SettingsSection>
    </div>
  );
}
