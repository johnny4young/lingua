export interface GuidedTourControls {
  closeOverlay: () => void;
}

export interface GuidedTourRuntimeProps {
  hasActiveOverlay: boolean;
  onActiveChange: (active: boolean) => void;
  startRequest: number;
}
