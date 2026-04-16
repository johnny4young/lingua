import { createContext, useContext } from 'react';

export interface GuidedTourContextValue {
  startTour: () => void;
  isTourActive: boolean;
  hasCompletedTour: boolean;
}

export const GuidedTourContext = createContext<GuidedTourContextValue | null>(null);

export function useGuidedTour() {
  const context = useContext(GuidedTourContext);
  if (!context) {
    throw new Error('useGuidedTour must be used within a GuidedTourProvider');
  }

  return context;
}

