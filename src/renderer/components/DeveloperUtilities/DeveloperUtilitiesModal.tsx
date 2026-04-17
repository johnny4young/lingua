import { Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITIES,
  findDeveloperUtility,
  type DeveloperUtilityId,
} from '../../data/developerUtilities';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { DeveloperUtilityPanel } from './UtilityPanels';

interface DeveloperUtilitiesModalProps {
  onClose: () => void;
  initialUtilityId?: DeveloperUtilityId;
}

export function DeveloperUtilitiesModal({
  onClose,
  initialUtilityId = DEFAULT_DEVELOPER_UTILITY_ID,
}: DeveloperUtilitiesModalProps) {
  const { t } = useTranslation();
  const [selectedUtilityId, setSelectedUtilityId] =
    useState<DeveloperUtilityId>(initialUtilityId);

  useEffect(() => {
    setSelectedUtilityId(initialUtilityId);
  }, [initialUtilityId]);

  const selectedUtility = findDeveloperUtility(selectedUtilityId);

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        data-testid="developer-utilities-modal"
        className="relative flex h-[min(84vh,820px)] w-full max-w-7xl flex-col overflow-hidden lg:flex-row"
      >
        <aside className="flex w-full shrink-0 flex-col border-b border-border/80 bg-background/55 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="surface-header flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-primary-soft text-primary">
                <Wrench size={18} />
              </div>
              <div>
                <p className="panel-title">{t('utilities.panelTitle')}</p>
                <h2 className="text-sm font-semibold text-foreground">
                  {t('utilities.title')}
                </h2>
              </div>
            </div>
            <IconButton onClick={onClose} tooltip={t('utilities.close')} aria-label={t('utilities.close')}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="border-b border-border/80 px-5 py-4">
            <p className="text-sm leading-6 text-muted">{t('utilities.description')}</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {DEVELOPER_UTILITIES.map((utility) => {
              const isSelected = utility.id === selectedUtilityId;
              return (
                <button
                  key={utility.id}
                  type="button"
                  onClick={() => setSelectedUtilityId(utility.id)}
                  aria-pressed={isSelected}
                  className={`mb-1 flex w-full flex-col rounded-[1.2rem] px-3 py-3 text-left transition-colors ${
                    isSelected
                      ? 'bg-primary-soft text-primary'
                      : 'text-foreground hover:bg-surface-strong/72'
                  }`}
                >
                  <span className="text-sm font-semibold">
                    {t(utility.titleKey)}
                  </span>
                  <span className={`text-xs leading-5 ${isSelected ? 'text-primary/80' : 'text-muted'}`}>
                    {t(utility.descriptionKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col bg-surface/38">
          <div className="surface-header px-6 py-5">
            <div className="grid gap-1">
              <p className="panel-title">{t('utilities.workspaceLabel')}</p>
              <h2 className="text-xl font-semibold text-foreground">
                {t(selectedUtility.titleKey)}
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-muted">
                {t(selectedUtility.descriptionKey)}
              </p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <DeveloperUtilityPanel toolId={selectedUtilityId} />
          </div>
        </main>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
