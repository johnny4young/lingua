import { useTranslation } from 'react-i18next';
import { RUN_POLICIES, RUN_POLICY_GROUPS } from '../../../shared/runPolicy';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../utils/cn';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';

/** When Scratchpad runs, per language group. Shown only with Run state on in Labs. */
export function RunPolicySection() {
  const { t } = useTranslation();
  const enabled = useSettingsStore(state => state.featureFlags.runState === true);
  const policies = useSettingsStore(state => state.runPolicyByGroup);
  const setRunPolicy = useSettingsStore(state => state.setRunPolicy);
  if (!enabled) return null;

  return (
    <SettingsSection eyebrow={t('settings.editor.runPolicy.title')}>
      <SpecCard>
        {RUN_POLICY_GROUPS.map((group, index) => (
          <SpecRow
            key={group}
            searchTargetId={index === 0 ? 'editor-run-policy' : undefined}
            label={t(`settings.editor.runPolicy.group.${group}`)}
            last={index === RUN_POLICY_GROUPS.length - 1}
            control={
              <div
                role="group"
                aria-label={t(`settings.editor.runPolicy.group.${group}`)}
                data-testid={`run-policy-${group}`}
                className="flex rounded-[7px] border border-border-subtle bg-bg-inset p-0.5"
              >
                {RUN_POLICIES.map(policy => (
                  <button
                    key={policy}
                    type="button"
                    aria-pressed={policies[group] === policy}
                    onClick={() => setRunPolicy(group, policy)}
                    data-testid={`run-policy-${group}-${policy}`}
                    className={cn(
                      'h-6 rounded-[5px] px-2.5 text-body-sm font-medium',
                      policies[group] === policy ? 'bg-bg-panel text-fg-base shadow-e1' : 'text-fg-muted hover:text-fg-base'
                    )}
                  >
                    {t(`settings.editor.runPolicy.option.${policy}`)}
                  </button>
                ))}
              </div>
            }
          />
        ))}
      </SpecCard>
    </SettingsSection>
  );
}
