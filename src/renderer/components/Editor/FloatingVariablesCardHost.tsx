import { useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { isVariableInspectorSupportedLanguage } from '../../stores/editorTabUtils';
import type { FloatingVariablesCardProps } from './FloatingVariablesCard';
import { loadFloatingVariablesCard } from './floatingVariablesCardLoader';

type FloatingVariablesCardComponent = ComponentType<FloatingVariablesCardProps>;

function FloatingVariablesCardLoadState({ failed }: { readonly failed: boolean }) {
  const { t } = useTranslation();
  const container = typeof document !== 'undefined' ? document.body : null;
  if (!container) return null;

  return createPortal(
    <section
      className="floating-variables-card fixed right-3 top-[196px] z-[35]"
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      aria-label={t('variableInspector.floating.title')}
      data-testid={
        failed ? 'floating-variables-card-load-failed' : 'floating-variables-card-loading'
      }
    >
      <div className="flex min-h-20 flex-col items-center justify-center gap-3 px-4 py-3 text-center">
        <p className="text-body-sm text-fg-muted">
          {t(
            failed ? 'variableInspector.floating.loadFailed' : 'variableInspector.floating.loading'
          )}
        </p>
        {failed ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => window.location.reload()}
          >
            {t('variableInspector.floating.reload')}
          </button>
        ) : null}
      </div>
    </section>,
    container
  );
}

/**
 * Startup-safe activation boundary for the floating Variables card.
 *
 * AppLayout mounts this host with the workspace, but the draggable portal and
 * value renderer load only after a supported non-Node tab enables Variables
 * and the latest run provides a matching scope snapshot.
 */
export function FloatingVariablesCardHost() {
  const activeTabId = useEditorStore(state => getActiveTab(state)?.id ?? null);
  const activeTabLanguage = useEditorStore(state => getActiveTab(state)?.language ?? null);
  const activeTabRuntimeMode = useEditorStore(state => getActiveTab(state)?.runtimeMode ?? null);
  const variableInspectorEnabled = useEditorStore(
    state => getActiveTab(state)?.variableInspectorEnabled === true
  );
  const scopeSnapshot = useResultStore(state => state.scopeSnapshot);
  const variableInspectorSurface = useSettingsStore(state => state.variableInspectorSurface);
  const [Card, setCard] = useState<FloatingVariablesCardComponent | null>(null);
  const [failed, setFailed] = useState(false);

  const enabled =
    variableInspectorSurface === 'floating' &&
    activeTabLanguage !== null &&
    variableInspectorEnabled &&
    activeTabRuntimeMode !== 'node' &&
    isVariableInspectorSupportedLanguage(activeTabLanguage) &&
    scopeSnapshot !== null &&
    scopeSnapshot.language === activeTabLanguage;

  useEffect(() => {
    if (!enabled || Card || failed) return;
    let active = true;
    void loadFloatingVariablesCard()
      .then(module => {
        if (!active) return;
        setCard(() => module.FloatingVariablesCard);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[variable-inspector] failed to load the floating Variables card', error);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [Card, enabled, failed]);

  if (!enabled || !activeTabId || !scopeSnapshot) return null;
  if (Card) {
    return <Card activeTabId={activeTabId} scopeSnapshot={scopeSnapshot} />;
  }
  return <FloatingVariablesCardLoadState failed={failed} />;
}
