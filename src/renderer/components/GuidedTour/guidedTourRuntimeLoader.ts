import type { ComponentType } from 'react';
import type { GuidedTourRuntimeProps } from './guidedTourRuntimeContract';

interface GuidedTourRuntimeModule {
  GuidedTourRuntime: ComponentType<GuidedTourRuntimeProps>;
}

let runtimePromise: Promise<GuidedTourRuntimeModule> | null = null;

export function loadGuidedTourRuntime(): Promise<GuidedTourRuntimeModule> {
  runtimePromise ??= import('./GuidedTourRuntime');
  return runtimePromise.catch((error: unknown) => {
    runtimePromise = null;
    throw error;
  });
}
