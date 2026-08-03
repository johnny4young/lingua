import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { GuidedTourContext } from './guidedTourContext';
import type { GuidedTourControls, GuidedTourRuntimeProps } from './guidedTourRuntimeContract';
import { loadGuidedTourRuntime } from './guidedTourRuntimeLoader';

interface GuidedTourProviderProps {
  children: ReactNode;
  controls: GuidedTourControls;
  hasActiveOverlay: boolean;
}

type GuidedTourRuntimeComponent = ComponentType<GuidedTourRuntimeProps>;

export function GuidedTourProvider({
  children,
  controls,
  hasActiveOverlay,
}: GuidedTourProviderProps) {
  const hasCompletedTour = useSettingsStore(state => state.hasCompletedTour);
  const [isTourActive, setIsTourActive] = useState(false);
  const [runtime, setRuntime] = useState<GuidedTourRuntimeComponent | null>(null);
  const [startRequest, setStartRequest] = useState(0);
  const loadPendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startTour = useCallback(() => {
    if (runtime) {
      setStartRequest(request => request + 1);
      return;
    }
    if (loadPendingRef.current) return;

    loadPendingRef.current = true;
    void loadGuidedTourRuntime()
      .then(module => {
        if (!mountedRef.current) return;
        setRuntime(() => module.GuidedTourRuntime);
        setStartRequest(request => request + 1);
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        console.error('[guided-tour] failed to load the tour runtime', error);
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'tour.error.loadFailed',
        });
      })
      .finally(() => {
        loadPendingRef.current = false;
      });
  }, [runtime]);

  const contextValue = useMemo(
    () => ({
      startTour,
      isTourActive,
      hasCompletedTour,
    }),
    [hasCompletedTour, isTourActive, startTour]
  );
  const Runtime = runtime;

  return (
    <GuidedTourContext.Provider value={contextValue}>
      {children}
      {Runtime ? (
        <Runtime
          controls={controls}
          hasActiveOverlay={hasActiveOverlay}
          onActiveChange={setIsTourActive}
          startRequest={startRequest}
        />
      ) : null}
    </GuidedTourContext.Provider>
  );
}
