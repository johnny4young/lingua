import { useTranslation } from 'react-i18next';
import { FEATURE_FLAG_IDS, FEATURE_FLAGS } from '../../../shared/featureFlags';
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
            label={t(FEATURE_FLAGS[id].labelKey)}
            description={t(FEATURE_FLAGS[id].descriptionKey)}
            last={index === FEATURE_FLAG_IDS.length - 1}
            control={
              <Toggle
                value={flags[id] === true}
                onChange={() => setFeatureFlag(id, flags[id] !== true)}
                aria-label={t(FEATURE_FLAGS[id].labelKey)}
                data-testid={`labs-flag-${id}`}
              />
            }
          />
        ))}
      </SpecCard>
    </SettingsSection>
  );
}
