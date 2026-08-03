import type { ComponentType } from 'react';
import type { FloatingVariablesCardProps } from './FloatingVariablesCard';

interface FloatingVariablesCardModule {
  FloatingVariablesCard: ComponentType<FloatingVariablesCardProps>;
}

let cardPromise: Promise<FloatingVariablesCardModule> | null = null;

/**
 * Share one floating Variables implementation across activations.
 *
 * Failed module fetches remain cached for the current document because
 * browsers retain failed module URLs. The host offers a page reload instead
 * of presenting a retry that cannot reliably recover.
 */
export function loadFloatingVariablesCard(): Promise<FloatingVariablesCardModule> {
  cardPromise ??= import('./FloatingVariablesCard');
  return cardPromise;
}
