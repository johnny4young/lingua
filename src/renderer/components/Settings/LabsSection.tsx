import { useTranslation } from 'react-i18next';
import '../../i18n/labsCatalog';
import { FEATURE_FLAG_IDS } from '../../../shared/featureFlags';
import { useSettingsStore } from '../../stores/settingsStore';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { Toggle } from './shared';

/** Experimental features, each off until turned on here. */
export function LabsSection() {
  const { t } = useTranslation();
  const flags = useSettingsStore(state => state.featureFlags);
  const setFeatureFlag = useSettingsStore(state => state.setFeatureFlag);

  return (
    <SettingsSection
      eyebrow={t('settings.labs.title')}
      description={t('settings.labs.description')}
    >
      <SpecCard>
        {FEATURE_FLAG_IDS.map((id, index) => (
          <SpecRow
            key={id}
            searchTargetId={`labs-${id}`}
            label={t(`settings.labs.flag.${id}.label`)}
            description={t(`settings.labs.flag.${id}.description`)}
            last={index === FEATURE_FLAG_IDS.length - 1}
            control={
              <Toggle
                value={flags[id] === true}
                onChange={() => setFeatureFlag(id, flags[id] !== true)}
                aria-label={t(`settings.labs.flag.${id}.label`)}
                data-testid={`labs-flag-${id}`}
              />
            }
          />
        ))}
      </SpecCard>
    </SettingsSection>
  );
}
