export interface GuidedTourControls {
  closeOverlay: () => void;
}

export interface GuidedTourRuntimeProps {
  controls: GuidedTourControls;
  hasActiveOverlay: boolean;
  onActiveChange: (active: boolean) => void;
  startRequest: number;
}
