import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import Shepherd, { type Tour } from 'shepherd.js';
import { createDefaultTab, useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { GuidedTourContext } from './guidedTourContext';
import { GUIDED_TOUR_SELECTORS, waitForGuidedTourSelector } from './guidedTourSelectors';
import { attachDontShowAgain, buildGuidedTourSteps } from './guidedTourSteps';

interface GuidedTourControls {
  closeOverlay: () => void;
  openPalette: () => void;
  openSnippets: () => void;
}

interface GuidedTourProviderProps {
  children: ReactNode;
  controls: GuidedTourControls;
}

function GuidedTourRuntime({
  children,
  controls,
}: GuidedTourProviderProps) {
  const { t } = useTranslation();
  const hasCompletedTour = useSettingsStore((state) => state.hasCompletedTour);
  const setHasCompletedTour = useSettingsStore((state) => state.setHasCompletedTour);
  const [isTourActive, setIsTourActive] = useState(false);
  const tourRef = useRef<Tour | null>(null);

  useEffect(() => {
    return () => {
      if (tourRef.current?.isActive()) {
        void tourRef.current.cancel();
      }
      tourRef.current = null;
    };
  }, []);

  const buildTour = () => {
    const tour = new Shepherd.Tour({
      tourName: 'guided-tour',
      useModalOverlay: true,
      defaultStepOptions: {
        cancelIcon: { enabled: true },
        classes: 'guided-tour-step',
        highlightClass: 'guided-tour-target',
        modalOverlayOpeningPadding: 10,
        modalOverlayOpeningRadius: 20,
        scrollTo: { behavior: 'smooth', block: 'center', inline: 'center' },
      },
    });

    tour.addSteps(
      buildGuidedTourSteps({
        t,
        closeOverlay: controls.closeOverlay,
        openPalette: controls.openPalette,
        openSnippets: controls.openSnippets,
        ensureConsoleVisible: () => useUIStore.getState().setConsoleVisible(true),
        ensureSidebarVisible: () => useUIStore.getState().setSidebarVisible(true),
        getSuppressTourAutoStart: () =>
          useSettingsStore.getState().suppressTourAutoStart,
        setSuppressTourAutoStart: (value) =>
          useSettingsStore.getState().setSuppressTourAutoStart(value),
      })
    );

    // Shepherd's step lifecycle hooks fire before the step DOM is actually
    // mounted under some configurations, so we watch the document for any
    // `.shepherd-footer` that appears and inject the "Don't show again"
    // checkbox there. `attachDontShowAgain` is idempotent (skips if already
    // present) so it stays safe to call multiple times per step.
    const observer = new MutationObserver(() => {
      const currentStep = tour.getCurrentStep();
      if (currentStep) {
        attachDontShowAgain(
          currentStep,
          t,
          () => useSettingsStore.getState().suppressTourAutoStart,
          (value) => useSettingsStore.getState().setSuppressTourAutoStart(value)
        );
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const disposeObserver = () => observer.disconnect();
    tour.on('complete', disposeObserver);
    tour.on('cancel', disposeObserver);

    tour.on('start', () => {
      setIsTourActive(true);
    });
    tour.on('complete', () => {
      setHasCompletedTour(true);
      setIsTourActive(false);
      controls.closeOverlay();
      tourRef.current = null;
    });
    tour.on('cancel', () => {
      setIsTourActive(false);
      controls.closeOverlay();
      tourRef.current = null;
    });

    tourRef.current = tour;
    return tour;
  };

  const startTour = async () => {
    controls.closeOverlay();

    const { tabs, addTab } = useEditorStore.getState();
    if (tabs.length === 0) {
      addTab(createDefaultTab('javascript'));
    }

    useUIStore.getState().setConsoleVisible(true);

    if (tourRef.current?.isActive()) {
      return;
    }

    await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.editor);

    const tour = buildTour();
    void tour.start();

    window.setTimeout(() => {
      if (document.querySelector('.shepherd-element') || tour.getCurrentStep()?.isOpen()) {
        return;
      }

      tour.show(0);
    }, 80);
  };

  const contextValue = {
    startTour,
    isTourActive,
    hasCompletedTour,
  };

  return (
    <GuidedTourContext.Provider value={contextValue}>
      {children}
    </GuidedTourContext.Provider>
  );
}

export function GuidedTourProvider({ children, controls }: GuidedTourProviderProps) {
  return <GuidedTourRuntime controls={controls}>{children}</GuidedTourRuntime>;
}
