import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  const loadPendingRef = useRef<ReturnType<typeof loadGuidedTourRuntime> | null>(null);
  const startGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const controlsRef = useRef(controls);

  useLayoutEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startGenerationRef.current += 1;
    };
  }, []);

  // A newer overlay owns focus, even before the lazy runtime has mounted.
  useLayoutEffect(() => {
    if (hasActiveOverlay) startGenerationRef.current += 1;
  }, [hasActiveOverlay]);

  const startTour = useCallback(() => {
    const generation = ++startGenerationRef.current;
    // Close the source overlay in the user's gesture, not when a chunk arrives:
    // a delayed close could otherwise dismiss an unrelated, newer dialog.
    controlsRef.current.closeOverlay();
    if (runtime) {
      setStartRequest(request => request + 1);
      return;
    }

    const pending = loadPendingRef.current ?? loadGuidedTourRuntime();
    loadPendingRef.current = pending;
    void pending
      .then(module => {
        if (!mountedRef.current) return;
        setRuntime(() => module.GuidedTourRuntime);
        if (generation === startGenerationRef.current) {
          setStartRequest(request => request + 1);
        }
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || generation !== startGenerationRef.current) return;
        console.error('[guided-tour] failed to load the tour runtime', error);
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'tour.error.loadFailed',
        });
      })
      .finally(() => {
        if (loadPendingRef.current === pending) loadPendingRef.current = null;
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
          hasActiveOverlay={hasActiveOverlay}
          onActiveChange={setIsTourActive}
          startRequest={startRequest}
        />
      ) : null}
    </GuidedTourContext.Provider>
  );
}
